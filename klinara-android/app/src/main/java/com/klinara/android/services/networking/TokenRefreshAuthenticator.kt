package com.klinara.android.services.networking

import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

/**
 * 401 gördüğünde bir kez yeniler ve isteği bir kez tekrarlar.
 *
 * OkHttp'nin `Authenticator`'ı seçildi çünkü `priorResponse` zinciri iOS'un `isRetry`
 * bayrağını bedava veriyor ve `ApiClient.send()`'den geçmeyen istekleri de kapsıyor.
 *
 * `runBlocking` burada sorun değil: `authenticate` zaten bir OkHttp dispatcher
 * thread'inde koşar, asla Main'de değil.
 */
internal class TokenRefreshAuthenticator(
    private val refresher: SessionRefresher,
) : Authenticator {
    override fun authenticate(
        route: Route?,
        response: Response,
    ): Request? {
        val tag = response.request.tag(ApiRequestTag::class.java) ?: return null

        // Yetki istemeyen ya da ara token taşıyan istekler yenilenmez: `mfa` token'ının
        // yenilenecek bir refresh eşi yoktur.
        if (!tag.requiresAuth || tag.bearerOverride != null) return null

        // Bir kez yenile, bir kez tekrarla. iOS `isRetry` bayrağının karşılığı.
        if (responseCount(response) > 1) return null

        val stale = response.request.header(KlinaraHeaders.AUTHORIZATION)?.removePrefix("Bearer ")
        val fresh = runBlocking { refresher.refresh(stale) } ?: return null

        return response.request
            .newBuilder()
            .header(KlinaraHeaders.AUTHORIZATION, "Bearer $fresh")
            .build()
    }

    private fun responseCount(response: Response): Int {
        var current: Response? = response
        var count = 0
        while (current != null) {
            count++
            current = current.priorResponse
        }
        return count
    }
}
