package com.klinara.android.services.networking

import com.klinara.android.services.auth.TokenStore
import okhttp3.Interceptor
import okhttp3.Response
import java.util.UUID

/**
 * Asla unutulmaması gereken ÜÇ başlık burada eklenir: `Accept`, `X-Request-Id` ve
 * `Authorization` (+ kapsamı varsa `X-Branch-Id`).
 *
 * `Idempotency-Key`, `If-Match` ve `Content-Type` burada DEĞİL, `ApiClient.execute()`
 * içinde set edilir: onlar isteğe özgü veridir, kesişen politika değil. Interceptor'ı
 * dar tutmak, ne yaptığını bir bakışta okunur kılar.
 */
internal class HeaderInterceptor(
    private val tokens: TokenStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val tag = original.tag(ApiRequestTag::class.java) ?: ApiRequestTag(false, null)

        val builder =
            original
                .newBuilder()
                .header(KlinaraHeaders.ACCEPT, KlinaraHeaders.APPLICATION_JSON)
                .header(KlinaraHeaders.REQUEST_ID, UUID.randomUUID().toString())

        when {
            // `mfa` ara token'ı: şube kapsamı YOKTUR, X-Branch-Id gönderilirse 400 olur.
            tag.bearerOverride != null ->
                builder.header(KlinaraHeaders.AUTHORIZATION, "Bearer ${tag.bearerOverride}")

            tag.requiresAuth ->
                tokens.cachedAccessToken()?.let { access ->
                    builder.header(KlinaraHeaders.AUTHORIZATION, "Bearer $access")
                    tokens.cachedBranchId()?.let { branch ->
                        builder.header(KlinaraHeaders.BRANCH_ID, branch)
                    }
                }
        }

        return chain.proceed(builder.build())
    }
}
