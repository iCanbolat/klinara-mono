package com.klinara.android.features.auth

import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.auth.MeResponse
import com.klinara.android.services.auth.TenantOption
import java.time.Instant

/**
 * Giriş akışının adımları.
 *
 * **Payload taşıyan sealed interface, iOS'un düz enum'u DEĞİL** (kasıtlı sapma, §7.8):
 * "kod olmadan yedek kod ekranı çizilemez" derleme zamanı gerçeği olur ve `step` ile
 * verisinin desenkronize olma hata sınıfı ortadan kalkar. Bedeli birkaç `copy()`.
 *
 * `challengeToken` burada YOK — ViewModel'de `private var`. State'te olan her şey
 * `toString()` üzerinden bir log'a ya da crash raporuna ulaşabilir.
 */
sealed interface AuthStep {
    /** Oturum diskten çözülüyor. Sistem splash'i bu adımı örter. */
    data object Launch : AuthStep

    data object Identifier : AuthStep

    data object Password : AuthStep

    data class Totp(val allowsBackupCode: Boolean) : AuthStep

    data class TotpSetup(
        val secret: String,
        val otpauthUri: String,
    ) : AuthStep

    data class BackupCodesDisplay(val codes: List<String>) : AuthStep

    data object BackupCode : AuthStep

    data object ForgotPasswordEmail : AuthStep

    data object ForgotPasswordSent : AuthStep

    data class TenantSelect(val options: List<TenantOption>) : AuthStep

    data class BranchSelect(val branches: List<BranchSummary>) : AuthStep

    data class PhoneVerification(
        val phone: String?,
        /** Geri sayım SUNUCUNUN değerinden türetilir, istemci sayacından değil. */
        val codeExpiresAt: Instant?,
    ) : AuthStep

    data object PasskeyEnrollOffer : AuthStep

    data class Authenticated(val session: AppSession) : AuthStep
}

/**
 * Oturum açıldıktan sonra kabuğun ihtiyaç duyduğu her şey.
 *
 * `permissions` sunucunun kararının **aynasıdır**; istemci onu yalnız yansıtır ve bir
 * güvenlik sınırı değildir (§5.7).
 */
data class AppSession(
    val profile: MeResponse,
    val branches: List<BranchSummary>,
    val activeBranchId: String?,
) {
    val activeBranch: BranchSummary?
        get() = branches.firstOrNull { it.id == activeBranchId }

    fun can(permission: String): Boolean = profile.permissions.contains(permission)
}

/** Kullanıcı tanımlayıcı olarak telefonu mu e-postayı mı veriyor. */
enum class IdentifierMode { Phone, Email }
