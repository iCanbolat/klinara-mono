package com.klinara.android.services.networking

/**
 * İsteğin kimlik doğrulama kipini OkHttp zincirine taşır.
 *
 * Tag burada güvenli, çünkü bu istekleri kuran **tek bir yer var**:
 * `ApiClient.execute()`. "Tag'i unuttum" erişilebilir bir durum değil.
 *
 * İmzalı yükleme için tag KULLANILMAZ — orada hata modu oturum bearer'ının üçüncü
 * parti nesne depolamasına sızması, yani bir güvenlik olayı. O yüzden ayrı, hiç
 * interceptor'ı olmayan bir istemci kullanılır (bkz. `OkHttpFactory`).
 */
internal data class ApiRequestTag(
    val requiresAuth: Boolean,
    val bearerOverride: String?,
)
