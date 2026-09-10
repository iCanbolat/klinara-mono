package com.klinara.android.services.auth

/**
 * Kimlik uçları. Uç yolları doc yorumlarında; `API_DEVELOPMENT.md` §4.7 sözleşmesi.
 *
 * `requiresAuth = false` olanlar: login, tenant, 2fa/verify, passkey options/verify,
 * password/forgot, refresh. `bearerOverride = challengeToken` olanlar: 2fa/setup,
 * 2fa/enable — `mfa` ara token'ı yalnız bu iki ucu açar (yumurta-tavuk akışı).
 */
interface AuthService {
    /** `POST auth/login` — e-posta VEYA telefon, tam olarak biri. */
    suspend fun login(
        email: String?,
        phone: String?,
        password: String,
        deviceLabel: String,
    ): LoginResponse

    /** `POST auth/tenant` */
    suspend fun selectTenant(
        challengeToken: String,
        tenantId: String,
    ): LoginResponse

    /** `POST auth/2fa/verify` — TOTP ve yedek kod AYNI ucu kullanır. */
    suspend fun verifyMfa(
        challengeToken: String,
        code: String,
        deviceLabel: String,
    ): LoginResponse

    /** `POST auth/2fa/setup` — bearerOverride. */
    suspend fun totpSetup(challengeToken: String): TotpSetup

    /** `POST auth/2fa/enable` — bearerOverride. Yedek kodlar YALNIZ burada, bir kez döner. */
    suspend fun totpEnable(
        challengeToken: String,
        code: String,
    ): List<String>

    /** `GET me` */
    suspend fun me(): MeResponse

    /** `GET branches` */
    suspend fun branches(): List<BranchSummary>

    /** `POST auth/phone/start` */
    suspend fun startPhoneVerification(phone: String): PhoneVerificationStarted

    /** `POST auth/phone/verify` */
    suspend fun verifyPhone(code: String): PhoneVerified

    /** `POST auth/password/forgot` — hesap sayımını önlemek için ASLA hata fırlatmaz. */
    suspend fun forgotPassword(email: String)

    /** `POST auth/logout` */
    suspend fun logout()

    // --- Passkey (A1.5'te canlanır; seam A1.1'de kurulur) ---

    /** `POST auth/passkey/options` — sunucunun WebAuthn options JSON'ı olduğu gibi döner. */
    suspend fun passkeyAssertionOptions(): String

    /** `POST auth/passkey/verify` */
    suspend fun passkeyVerify(
        responseJson: String,
        deviceLabel: String,
    ): LoginResponse

    /** `POST auth/passkeys/register/options` */
    suspend fun passkeyRegistrationOptions(): String

    /** `POST auth/passkeys/register` */
    suspend fun registerPasskey(
        responseJson: String,
        deviceLabel: String,
    )
}
