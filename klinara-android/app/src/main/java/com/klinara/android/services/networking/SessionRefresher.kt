package com.klinara.android.services.networking

import com.klinara.android.services.auth.AuthTokens
import com.klinara.android.services.auth.TokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable
private data class RefreshBody(val refreshToken: String)

/**
 * Tek uçuşlu (single-flight) token yenileme.
 *
 * Eş zamanlı N istek **tek** `POST /auth/refresh` tetikler. Aksi hâlde açılışta paralel
 * koşan üç istek üç kez rotate eder ve sunucudaki refresh reuse-detection tüm oturum
 * ailesini iptal eder — kullanıcı sebepsiz çıkar.
 *
 * iOS'un `actor` tabanlı çözümüne göre **iki iyileştirme** içerir (ikisi de Swift'e
 * geri taşınmalı):
 *
 * 1. **Bayat token karşılaştırması.** iOS paylaşılan task'ı `defer` ile temizlediği
 *    için, başarılı bir yenilemeden mikrosaniyeler sonra gelen bir 401 bekleyecek task
 *    bulamaz ve İKİNCİ kez rotate eder — tam da kaçınılmak istenen kıyım. Burada
 *    çağıran, kendi bayat bearer'ını depodakiyle **kilit altında** karşılaştırır;
 *    farklıysa başkası zaten döndürmüştür ve tekrar rotate edilmez.
 * 2. **Uygulama ömrüne bağlı kapsam.** Yenileme ilk gelen çağıranın kapsamında
 *    koşsaydı, o çağıranın iptali (ekran kapandı, kullanıcı gezindi) herkesin
 *    yenilemesini iptal ederdi.
 */
internal class SessionRefresher(
    private val tokens: TokenStore,
    /** İnterceptor'ı ve Authenticator'ı OLMAYAN istemci — yeniden girişi imkânsız kılar. */
    private val bareHttp: OkHttpClient,
    private val baseUrl: HttpUrl,
    private val scope: CoroutineScope,
    private val onExpired: suspend () -> Unit,
) {
    private val mutex = Mutex()
    private var inFlight: Deferred<String?>? = null

    /**
     * @param staleAccessToken 401 alan isteğin taşıdığı bearer.
     * @return yeni access token, ya da oturum düştüyse null.
     */
    suspend fun refresh(staleAccessToken: String?): String? {
        val job =
            mutex.withLock {
                // Karşılaştırma KİLİDİN İÇİNDE olmalı. Dışarıda yapıldığında şu pencere
                // açıktı: B bayat token'ı okur → A'nın yenilemesi biter ve `finally`
                // `inFlight`'ı temizler → B kilidi alır, `inFlight` boş → İKİNCİ rotate.
                // Kilit altında iki durum kalır: ya uçuşta bir yenileme vardır (ona
                // katıl), ya da önceki yenileme `tokens`'a çoktan yazmıştır (aşağıda
                // yakalanır) — `inFlight` ancak `doRefresh` bittikten sonra temizlenir.
                //
                // Farklıysa başkası zaten sonuçlandırmıştır: döndürdüyse yeni token,
                // başarısız olup oturumu sildiyse null. İkincisinde tekrar yenilemek
                // `onExpired`'ı ikinci kez tetiklerdi.
                val current = tokens.cachedAccessToken()
                if (current != staleAccessToken) return current

                inFlight ?: scope.async(start = CoroutineStart.LAZY) { doRefresh() }.also { inFlight = it }
            }

        return try {
            job.await()
        } finally {
            mutex.withLock { if (inFlight === job) inFlight = null }
        }
    }

    private suspend fun doRefresh(): String? {
        val refreshToken = tokens.refreshToken() ?: return expire()

        val request =
            Request
                .Builder()
                .url(baseUrl.newBuilder().addPathSegments(REFRESH_PATH).build())
                .post(
                    KlinaraJson
                        .encodeToString(RefreshBody(refreshToken))
                        .toRequestBody(JSON_MEDIA_TYPE),
                ).header(KlinaraHeaders.ACCEPT, KlinaraHeaders.APPLICATION_JSON)
                .header(KlinaraHeaders.REQUEST_ID, java.util.UUID.randomUUID().toString())
                .build()

        val fresh =
            runCatching {
                bareHttp.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@runCatching null
                    KlinaraJson.decodeFromString<AuthTokens>(response.body.string())
                }
            }.getOrNull() ?: return expire()

        tokens.save(fresh)
        return fresh.accessToken
    }

    private suspend fun expire(): String? {
        tokens.clear()
        onExpired()
        return null
    }

    private companion object {
        const val REFRESH_PATH = "auth/refresh"
    }
}
