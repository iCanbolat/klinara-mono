package com.klinara.android.services.networking

import com.klinara.android.services.auth.TokenStore
import kotlinx.coroutines.CoroutineScope
import okhttp3.Authenticator
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * İki istemci: biri bizim API'miz, biri çıplak.
 *
 * Ayrım stilistik değil, **hata moduna göre**:
 * - İmzalı yükleme ve `/auth/refresh` `bareHttp` kullanır. Buradaki hata modu oturum
 *   bearer'ının üçüncü parti nesne depolamasına sızması ya da yenilemenin kendi
 *   `Authenticator`'ına yeniden girmesi. Hiç interceptor kurulmamış bir istemcide
 *   ikisi de **yapısal olarak imkânsız**.
 * - Kendi API'miz tag kullanır, çünkü bu istekleri kuran tek yer `ApiClient.execute()`.
 *
 * `bareHttp` `newBuilder()` ile türetilir: bağlantı havuzunu, dispatcher'ı ve DNS'i
 * paylaşır — ek soket ya da thread maliyeti yok.
 */
internal object OkHttpFactory {
    private const val CALL_TIMEOUT_SECONDS = 20L
    private const val CONNECT_TIMEOUT_SECONDS = 10L

    data class Clients(
        val api: OkHttpClient,
        val bare: OkHttpClient,
        val refresher: SessionRefresher,
    )

    fun create(
        tokens: TokenStore,
        scope: CoroutineScope,
        onExpired: suspend () -> Unit,
        // Testler MockWebServer'ı gösterir; üretimde her zaman ApiEnvironment.
        baseUrl: okhttp3.HttpUrl = ApiEnvironment.baseUrl,
    ): Clients {
        // Önce çıplak istemci: yenileyici ona ihtiyaç duyuyor.
        val bare =
            OkHttpClient
                .Builder()
                .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                // Sağlık verisi diskte artakalmamalı; önbellek HİÇ kurulmaz.
                .cache(null)
                .authenticator(Authenticator.NONE)
                .build()

        val refresher =
            SessionRefresher(
                tokens = tokens,
                bareHttp = bare,
                baseUrl = baseUrl,
                scope = scope,
                onExpired = onExpired,
            )

        val api =
            bare
                .newBuilder()
                .addInterceptor(HeaderInterceptor(tokens))
                .authenticator(TokenRefreshAuthenticator(refresher))
                .build()

        return Clients(api = api, bare = bare, refresher = refresher)
    }
}
