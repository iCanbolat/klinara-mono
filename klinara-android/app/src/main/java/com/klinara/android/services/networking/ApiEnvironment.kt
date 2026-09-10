package com.klinara.android.services.networking

import com.klinara.android.BuildConfig
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * İstemci yapılandırması. Uygulama açılışında **fail-fast** doğrulanır: yanlış
 * yapılandırılmış bir derlemenin ilk ağ çağrısına kadar sessiz kalması, hatayı
 * bulunması en zor yere taşır (iOS `APIEnvironment` aynı gerekçeyle `fatalError` atar).
 */
object ApiEnvironment {
    /**
     * `/api/v1` önekini ZATEN içerir — `ApiRequest.path` öneksizdir ve iOS ile
     * karakter karakter aynı kalır.
     */
    val baseUrl: HttpUrl by lazy {
        val raw = BuildConfig.KLINARA_API_BASE_URL
        val url = raw.trimEnd('/').plus("/").toHttpUrlOrNull()
        requireNotNull(url) {
            "KLINARA_API_BASE_URL çözülemedi: '$raw'. local.properties'te klinara.apiBaseUrl ayarlayın."
        }
    }

    /**
     * WebAuthn Relying Party kimliği (A1.5).
     *
     * Boş olabilir: passkey ertelendiği sürece kullanılmaz. **Bir IP adresi asla
     * geçerli bir RP ID değildir** — `10.0.2.2` ya da `localhost` üzerinden passkey
     * geliştirilemez; gerçek bir https konak ve `/.well-known/assetlinks.json` gerekir.
     */
    val webAuthnRpId: String
        get() = BuildConfig.KLINARA_WEBAUTHN_RP_ID

    /**
     * Passkey akışı sürülebilir mi?
     *
     * **Bir IP adresi asla geçerli bir RP ID değildir** — WebAuthn RP ID kayıtlanabilir
     * bir alan adı olmak zorunda. Bu yüzden `10.0.2.2` ya da `localhost` üzerinden
     * passkey geliştirilemez; A1.5 gerçek bir https konak ve orada yayınlanmış bir
     * `/.well-known/assetlinks.json` bekler (ön koşul P3).
     */
    val isPasskeyConfigured: Boolean
        get() {
            val rpId = webAuthnRpId
            if (rpId.isBlank()) return false
            if (rpId == "localhost") return false
            // Nokta ile ayrılmış her parçası sayı ise bu bir IPv4'tür, alan adı değil.
            val looksLikeIpV4 =
                rpId.split('.').let { it.size == IPV4_LABEL_COUNT && it.all(::isNumericLabel) }
            return !looksLikeIpV4 && rpId.contains('.')
        }

    private fun isNumericLabel(label: String) = label.isNotEmpty() && label.all(Char::isDigit)

    private const val IPV4_LABEL_COUNT = 4
}
