package com.klinara.android.features.auth

/**
 * Ekranın gördüğü her şey.
 *
 * [toString] parolayı **redakte eder**: bir state nesnesi crash raporuna,
 * `Log.d`'ye ya da bir hata ayıklama aracına düştüğünde parolanın orada olmaması
 * gerekir. detekt zaten `Log.d`'yi yasaklıyor ama savunma tek katmana bırakılmaz.
 */
data class AuthUiState(
    val step: AuthStep = AuthStep.Launch,
    val isBusy: Boolean = false,
    val overlayMessage: String? = null,
    val error: AuthErrorState? = null,
    // --- Kullanıcı girdileri ---
    val identifierMode: IdentifierMode = IdentifierMode.Phone,
    val phoneE164: String = "",
    val email: String = "",
    val password: String = "",
    val mfaCode: String = "",
    val backupCode: String = "",
    val smsCode: String = "",
    val phoneToVerify: String = "",
    val forgotPasswordEmail: String = "",
    val totpSetupCode: String = "",
    // --- Türetilmiş ---
    val canGoBack: Boolean = false,
    val offersPasskeyShortcut: Boolean = false,
) {
    val identifierSummary: String
        get() =
            when (identifierMode) {
                IdentifierMode.Phone -> phoneE164
                IdentifierMode.Email -> email
            }

    val canSubmitIdentifier: Boolean
        get() =
            when (identifierMode) {
                // PhoneNumberField tamamlanmamış numarada "" verir; tek kontrol yeter.
                IdentifierMode.Phone -> phoneE164.isNotEmpty()
                IdentifierMode.Email -> email.contains('@') && email.length > MIN_EMAIL_LENGTH
            }

    /** Sunucu minimumu. Daha kısa bir parolayı göndermek boşa bir istek ve boş bir hata. */
    val canSubmitPassword: Boolean get() = password.length >= MIN_PASSWORD_LENGTH

    val canSubmitMfaCode: Boolean get() = mfaCode.length == TOTP_LENGTH

    val canSubmitBackupCode: Boolean get() = backupCode.isNotBlank()

    val canSubmitSmsCode: Boolean get() = smsCode.length == TOTP_LENGTH

    val canSubmitTotpSetupCode: Boolean get() = totpSetupCode.length == TOTP_LENGTH

    val canSubmitForgotPassword: Boolean get() = forgotPasswordEmail.contains('@')

    val canSubmitPhoneToVerify: Boolean get() = phoneToVerify.isNotEmpty()

    override fun toString(): String =
        "AuthUiState(step=$step, isBusy=$isBusy, error=$error, mode=$identifierMode, password=***)"

    companion object {
        const val MIN_PASSWORD_LENGTH = 10
        const val TOTP_LENGTH = 6
        private const val MIN_EMAIL_LENGTH = 4
    }
}

/**
 * Ekranda gösterilecek hata.
 *
 * `ApiError` doğrudan taşınmaz: ekranın ihtiyacı olan üç şey (mesaj, tekrar denenebilir
 * mi, destek referansı) burada; geri kalanı bir sunum katmanının bilmesi gereken şey değil.
 */
data class AuthErrorState(
    val message: String,
    val isRetryable: Boolean = false,
    val supportReference: String? = null,
    /** Alan bazlı hatalar ekran afişi yerine alanın altına basılır. */
    val fieldErrors: Map<String, String> = emptyMap(),
)
