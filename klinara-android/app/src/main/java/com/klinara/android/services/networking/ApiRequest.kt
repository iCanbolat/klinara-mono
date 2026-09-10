package com.klinara.android.services.networking

/** HTTP fiilleri. Sunucu sözleşmesinde kullanılanlar. */
enum class HttpMethod(val wire: String, val requiresBody: Boolean) {
    GET("GET", requiresBody = false),
    POST("POST", requiresBody = true),
    PATCH("PATCH", requiresBody = true),
    PUT("PUT", requiresBody = true),
    DELETE("DELETE", requiresBody = false),
}

/**
 * Bir istek tanımı. iOS `APIRequest` ile birebir aynı alanlar ve varsayılanlar —
 * iki istemcinin uç tanımları yan yana karşılaştırılabilir kalsın diye.
 *
 * [path] önek TAŞIMAZ: taban URL zaten `/api/v1` içeriyor (iOS `Info.plist`
 * `KlinaraAPIBaseURL` paritesi).
 */
data class ApiRequest(
    val method: HttpMethod,
    val path: String,
    val query: List<Pair<String, String>> = emptyList(),
    val body: RequestBodyPayload? = null,
    /** false ise `Authorization` ve `X-Branch-Id` hiç eklenmez. */
    val requiresAuth: Boolean = true,
    /**
     * `mfa` ara token'ı. Verilirse access token yerine bu kullanılır ve
     * `X-Branch-Id` **eklenmez** — ara token'ın şube kapsamı yoktur.
     */
    val bearerOverride: String? = null,
    val idempotencyKey: String? = null,
    /** Zayıf ETag değeri; [weakETag] ile üretilir. */
    val ifMatch: String? = null,
) {
    companion object {
        fun get(
            path: String,
            query: List<Pair<String, String>> = emptyList(),
            requiresAuth: Boolean = true,
        ) = ApiRequest(HttpMethod.GET, path, query = query, requiresAuth = requiresAuth)

        fun post(
            path: String,
            body: RequestBodyPayload? = null,
            requiresAuth: Boolean = true,
            bearerOverride: String? = null,
            idempotencyKey: String? = null,
            ifMatch: String? = null,
        ) = ApiRequest(
            HttpMethod.POST,
            path,
            body = body,
            requiresAuth = requiresAuth,
            bearerOverride = bearerOverride,
            idempotencyKey = idempotencyKey,
            ifMatch = ifMatch,
        )

        fun patch(
            path: String,
            body: RequestBodyPayload? = null,
            ifMatch: String? = null,
        ) = ApiRequest(HttpMethod.PATCH, path, body = body, ifMatch = ifMatch)

        fun put(
            path: String,
            body: RequestBodyPayload? = null,
        ) = ApiRequest(HttpMethod.PUT, path, body = body)

        fun delete(
            path: String,
            ifMatch: String? = null,
        ) = ApiRequest(HttpMethod.DELETE, path, ifMatch = ifMatch)

        /** `3` → `W/"3"` — sunucunun beklediği zayıf ETag biçimi. */
        fun weakETag(version: Int): String = "W/\"$version\""
    }
}

/**
 * Serileştirilmiş istek gövdesi.
 *
 * Gövde çağrı yerinde JSON'a çevrilir (`KlinaraJson.encode`), böylece [ApiClient]
 * generic bir `Encodable` kısıtı taşımak zorunda kalmaz ve reified tip parametresi
 * yalnız YANIT tarafında gerekir.
 */
@JvmInline
value class RequestBodyPayload(val json: String)
