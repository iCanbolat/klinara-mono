package com.klinara.android.services.networking

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

internal val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

/**
 * Tüm sunucu trafiğinin tek boğazı.
 *
 * Üç garanti burada, tek yerde durur:
 * 1. **Başlıklar** — `HeaderInterceptor` ile; bir uçta unutulması mümkün değil.
 * 2. **Hata dönüşümü** — 2xx dışı her yanıt `problem+json` olarak çözülür ve
 *    [ApiError]'a indirgenir. Ekranlar HTTP durum kodu görmez.
 * 3. **Tek uçuşlu yenileme** — `TokenRefreshAuthenticator` + [SessionRefresher].
 *
 * **Yanıt önbelleği hiç kurulmaz** (`cache(null)`): hasta/randevu verisi diskte
 * artakalmamalı; ayrıca "kaydettim ama liste eski" hatasının en sık sebebi budur.
 */
class ApiClient internal constructor(
    private val http: OkHttpClient,
    private val baseUrl: HttpUrl,
    @PublishedApi internal val json: Json = KlinaraJson,
) {
    private val _sessionExpired =
        MutableSharedFlow<Unit>(
            replay = 0,
            extraBufferCapacity = 1,
            onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST,
        )

    /**
     * Oturum düştüğünde tek atım. Callback DEĞİL akış: Activity yeniden yaratılırken
     * bir callback null olur ve o pencereye düşen sona erme sessizce yutulur —
     * kullanıcı sonsuza dek 401 üreten bir ekranda oturur. `extraBufferCapacity = 1`
     * olayın sonraki toplayıcıyı beklemesini, `DROP_OLDEST` bir 401 fırtınasının tek
     * bir çıkışa çökmesini sağlar.
     */
    val sessionExpired: SharedFlow<Unit> = _sessionExpired

    internal fun notifySessionExpired() {
        // tryEmit: suspend değil, OkHttp thread'inden güvenli.
        _sessionExpired.tryEmit(Unit)
    }

    /** Gövdeli yanıt. */
    suspend inline fun <reified T> send(request: ApiRequest): T {
        val bytes = execute(request)
        return decode(bytes)
    }

    /**
     * Gövdesi umursanmayan yanıt (204, ya da yalnız yan etkisi olan POST'lar).
     *
     * Ayrı bir ad, dönüş tipine göre aşırı yükleme JVM'de mümkün olmadığı için;
     * `send<Unit>` yazmak çözümlemeyi tetikler ve 204'te patlardı.
     */
    suspend fun sendVoid(request: ApiRequest) {
        execute(request)
    }

    /**
     * Boş gövdeli 200'ü `null` olarak döndürür.
     *
     * `GET /integrations/whatsapp` hesap kurulmamışken boş gövde döndürüyor ve bu
     * **beklenen bir sonuçtur**, bozuk yanıt değil. Kurulmamış bir şeyi bozuk
     * göstermek, kullanıcıyı olmayan bir hatayı aramaya yollar.
     */
    suspend inline fun <reified T> sendOptional(request: ApiRequest): T? {
        val bytes = execute(request)
        if (bytes.isEmpty()) return null
        return decode(bytes)
    }

    @PublishedApi
    internal inline fun <reified T> decode(bytes: ByteArray): T =
        try {
            json.decodeFromString<T>(bytes.decodeToString())
        } catch (e: SerializationException) {
            throw ApiError.MalformedResponse(e.toString(), e)
        } catch (e: IllegalArgumentException) {
            throw ApiError.MalformedResponse(e.toString(), e)
        }

    /** Ham gövdeyi döndürür; 2xx dışı her şey [ApiError] olarak fırlar. */
    @PublishedApi
    internal suspend fun execute(request: ApiRequest): ByteArray {
        val httpRequest = build(request)

        // Ağ G/Ç'si IO'da (A8.3 düzeltmesi — `executeOffMain`): ViewModel'ler Main'den çağırıyor.
        val (bytes, status, ok) =
            try {
                http.executeOffMain(httpRequest) { Triple(it.body.bytes(), it.code, it.isSuccessful) }
            } catch (e: IOException) {
                // OkHttp iptal edilmiş çağrıyı IOException("Canceled") olarak yüzeye
                // çıkarır. Bunu `Network`e eşlemek her gezinmeyi sahte bir "bağlantı
                // hatası" afişine çevirirdi. iOS'un URLError.cancelled kontrolünün
                // karşılığı ve atlanması çok kolay.
                currentCoroutineContext().ensureActive()
                throw ApiError.Network(e)
            }

        if (!ok) throw problem(bytes, status)
        return bytes
    }

    private fun build(request: ApiRequest): Request {
        val url =
            baseUrl
                .newBuilder()
                .addPathSegments(request.path.trimStart('/'))
                .apply { request.query.forEach { (name, value) -> addQueryParameter(name, value) } }
                .build()

        // OkHttp POST/PUT/PATCH için gövde ZORUNLU tutar, ama `POST /auth/logout` ve
        // `POST /auth/2fa/setup` gibi uçlar gövdesizdir. Boş gövde `null` medya tipiyle
        // gönderilir: Content-Type başlığı OLUŞMAZ ve iOS'un davranışı korunur
        // (Content-Type yalnız gerçekten gövde varken).
        val body =
            request.body?.json?.toRequestBody(JSON_MEDIA_TYPE)
                ?: EMPTY_BODY.takeIf { request.method.requiresBody }

        return Request
            .Builder()
            .url(url)
            .method(request.method.wire, body)
            .tag(
                ApiRequestTag::class.java,
                ApiRequestTag(request.requiresAuth, request.bearerOverride),
            ).apply {
                request.idempotencyKey?.let { header(KlinaraHeaders.IDEMPOTENCY_KEY, it) }
                request.ifMatch?.let { header(KlinaraHeaders.IF_MATCH, it) }
            }.build()
    }

    /**
     * Gövde çözülemezse durum kodundan bir problem SENTEZLENİR. Sunucunun bir yerde
     * HTML hata sayfası döndürmesi, ekranın çökmesine değil anlaşılır bir mesaja
     * dönüşmeli.
     */
    private fun problem(
        bytes: ByteArray,
        status: Int,
    ): ApiError {
        val decoded =
            runCatching { json.decodeFromString<ProblemDetails>(bytes.decodeToString()) }.getOrNull()

        val details =
            decoded?.takeIf { it.status != 0 || it.title.isNotEmpty() }
                ?: ProblemDetails(
                    code =
                        if (status >= HTTP_SERVER_ERROR) {
                            com.klinara.android.services.contracts.ApiErrorCode.INTERNAL_ERROR
                        } else {
                            com.klinara.android.services.contracts.ApiErrorCode.UNKNOWN
                        },
                    title = "Beklenmeyen yanıt",
                    status = status,
                )

        val error = ApiError.Problem(details.copy(status = if (details.status == 0) status else details.status))
        if (error.invalidatesSession) notifySessionExpired()
        return error
    }

    private companion object {
        const val HTTP_SERVER_ERROR = 500
        val EMPTY_BODY = ByteArray(0).toRequestBody(null)
    }
}
