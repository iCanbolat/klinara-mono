package com.klinara.android.features.auth

import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.auth.TenantOption
import com.klinara.android.services.passkey.PasskeyOutcome

/**
 * Ekrandan ViewModel'e giden her şey.
 *
 * Tek yönlü akış: ekran [AuthUiState] okur, `onEvent(...)` çağırır. iOS store'larındaki
 * `func submitPassword()` metotlarının doğrudan karşılığı — yeni bir MVI çerçevesi
 * getirilmedi.
 */
sealed interface AuthEvent {
    data object Start : AuthEvent

    /** Açılışta sunucuya ulaşılamadıysa: oturumu tekrar çözmeyi dene. */
    data object RetrySessionRestore : AuthEvent

    // --- Tanımlayıcı ---
    data class PhoneChanged(val e164: String) : AuthEvent

    data class EmailChanged(val value: String) : AuthEvent

    data object SwitchIdentifierMode : AuthEvent

    data object SubmitIdentifier : AuthEvent

    // --- Parola ---
    data class PasswordChanged(val value: String) : AuthEvent

    data object SubmitPassword : AuthEvent

    data object OpenForgotPassword : AuthEvent

    // --- MFA ---
    data class MfaCodeChanged(val value: String) : AuthEvent

    data object SubmitMfaCode : AuthEvent

    data class BackupCodeChanged(val value: String) : AuthEvent

    data object SubmitBackupCode : AuthEvent

    data object UseBackupCode : AuthEvent

    data object UseAuthenticatorCode : AuthEvent

    data class TotpSetupCodeChanged(val value: String) : AuthEvent

    data object ConfirmTotpSetup : AuthEvent

    data object FinishBackupCodesDisplay : AuthEvent

    // --- Kiracı / şube ---
    data class SelectTenant(val tenant: TenantOption) : AuthEvent

    data class SelectBranch(val branch: BranchSummary) : AuthEvent

    // --- Parola kurtarma ---
    data class ForgotPasswordEmailChanged(val value: String) : AuthEvent

    data object SubmitForgotPassword : AuthEvent

    // --- Telefon doğrulama ---
    data class PhoneToVerifyChanged(val e164: String) : AuthEvent

    data object SendPhoneCode : AuthEvent

    data class SmsCodeChanged(val value: String) : AuthEvent

    data object SubmitPhoneCode : AuthEvent

    data object ChangePhoneNumber : AuthEvent

    // --- Passkey (A1.5'te canlanır) ---
    data object SignInWithPasskey : AuthEvent

    data object EnrollPasskey : AuthEvent

    data object SkipPasskeyEnrollment : AuthEvent

    data class PasskeyCompleted(val outcome: PasskeyOutcome) : AuthEvent

    // --- Genel ---
    data object Back : AuthEvent

    data object DismissError : AuthEvent

    data object Logout : AuthEvent

    /** Yalnız debug: geliştirici senaryo menüsü değişti. */
    data object ScenarioChanged : AuthEvent
}

/**
 * Tek atımlık yan etkiler. State'te DEĞİL: bir efekt state'e konursa döndürmede ya da
 * yeniden abone olunduğunda tekrar tetiklenir.
 */
sealed interface AuthEffect {
    /** Ekran Credential Manager'ı çağırmalı — ViewModel `Activity` görmez. */
    data class RequestPasskey(
        val optionsJson: String,
        val mode: PasskeyMode,
    ) : AuthEffect

    enum class PasskeyMode { Assert, Create }
}
