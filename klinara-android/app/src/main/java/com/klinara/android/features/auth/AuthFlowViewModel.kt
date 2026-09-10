package com.klinara.android.features.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.klinara.android.KlinaraApplication
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.auth.LoginOutcome
import com.klinara.android.services.auth.MeResponse
import com.klinara.android.services.auth.TenantOption
import com.klinara.android.services.auth.outcome
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.passkey.PasskeyOutcome
import com.klinara.android.services.passkey.PasskeyService
import com.klinara.android.services.passkey.UnavailablePasskeyService
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch

/**
 * Giriş akışının **tek** durum makinesi.
 *
 * Ekranlar durumsuzdur; tüm yönlendirme kararları sunucu yanıtlarından çıkar (tek klinik
 * varsa kiracı seçimi atlanır, tek şube varsa şube seçimi atlanır).
 *
 * ### `SavedStateHandle` neden YOK?
 *
 * Çekingenlik değil, **doğruluk**. `step`'i kaydetmek kullanıcıyı, challenge token'ı
 * yalnız bellekte olan bir TOTP ekranına geri koyardı — başarılı olması **imkânsız** bir
 * ekran. §5.2/§7.9 zaten başka bir şeyin yazılmasını yasaklıyor.
 *
 * Süreç ölümünde ViewModel `Launch`'tan başlar, [start] koşar ve **`TokenStore` (disk,
 * şifreli) tek otoritedir**: oturum varsa `Authenticated`, yoksa `Identifier`. Yarım
 * kalmış bir MFA challenge'ını kaybetmek güvenlik açısından da doğru cevaptır.
 *
 * Kabuğa girildikten sonra (A2.1) politika dokümanın dediğine döner: yalnız kimlikler ve
 * filtreler, asla veri.
 */
class AuthFlowViewModel(
    private val container: ServiceContainer,
    private val passkey: PasskeyService = UnavailablePasskeyService(),
) : ViewModel() {
    private val _state = MutableStateFlow(AuthUiState())
    val state: StateFlow<AuthUiState> = _state.asStateFlow()

    private val _effects = Channel<AuthEffect>(Channel.BUFFERED)
    val effects = _effects.receiveAsFlow()

    /** ASLA state'e konmaz: state bir log'a ya da crash raporuna düşebilir. */
    private var challengeToken: String? = null

    /** Passkey kayıt teklifi yalnız parolayla giren, henüz kaydı olmayan kullanıcıya. */
    private var didUsePasswordLogin: Boolean = false

    private var profile: MeResponse? = null
    private var visibleBranches: List<BranchSummary> = emptyList()

    init {
        // Callback DEĞİL akış: Activity yeniden yaratılırken bir callback null olur ve o
        // pencereye düşen sona erme sessizce yutulur (bkz. ApiClient.sessionExpired).
        viewModelScope.launch {
            container.sessionExpired.collect { forceLogout() }
        }
    }

    fun onEvent(event: AuthEvent) {
        when (event) {
            AuthEvent.Start, AuthEvent.RetrySessionRestore -> start()

            is AuthEvent.PhoneChanged -> update { copy(phoneE164 = event.e164) }
            is AuthEvent.EmailChanged -> update { copy(email = event.value) }
            AuthEvent.SwitchIdentifierMode -> switchIdentifierMode()
            AuthEvent.SubmitIdentifier -> submitIdentifier()

            is AuthEvent.PasswordChanged -> update { copy(password = event.value) }
            AuthEvent.SubmitPassword -> submitPassword()
            AuthEvent.OpenForgotPassword -> goTo(AuthStep.ForgotPasswordEmail)

            is AuthEvent.MfaCodeChanged -> update { copy(mfaCode = event.value) }
            AuthEvent.SubmitMfaCode -> submitSecondFactor(state.value.mfaCode)
            is AuthEvent.BackupCodeChanged -> update { copy(backupCode = event.value) }
            AuthEvent.SubmitBackupCode -> submitSecondFactor(state.value.backupCode)
            AuthEvent.UseBackupCode -> goTo(AuthStep.BackupCode)
            AuthEvent.UseAuthenticatorCode -> goTo(AuthStep.Totp(allowsBackupCode = true))
            is AuthEvent.TotpSetupCodeChanged -> update { copy(totpSetupCode = event.value) }
            AuthEvent.ConfirmTotpSetup -> confirmTotpSetup()
            AuthEvent.FinishBackupCodesDisplay -> finishBackupCodesDisplay()

            is AuthEvent.SelectTenant -> selectTenant(event.tenant)
            is AuthEvent.SelectBranch -> selectBranch(event.branch)

            is AuthEvent.ForgotPasswordEmailChanged -> update { copy(forgotPasswordEmail = event.value) }
            AuthEvent.SubmitForgotPassword -> submitForgotPassword()

            is AuthEvent.PhoneToVerifyChanged -> update { copy(phoneToVerify = event.e164) }
            AuthEvent.SendPhoneCode -> sendPhoneCode()
            is AuthEvent.SmsCodeChanged -> update { copy(smsCode = event.value) }
            AuthEvent.SubmitPhoneCode -> submitPhoneCode()
            AuthEvent.ChangePhoneNumber -> changePhoneNumber()

            AuthEvent.SignInWithPasskey -> signInWithPasskey()
            AuthEvent.EnrollPasskey -> enrollPasskey()
            AuthEvent.SkipPasskeyEnrollment -> finishAuthentication()
            is AuthEvent.PasskeyCompleted -> handlePasskeyOutcome(event.outcome)

            AuthEvent.Back -> goBack()
            AuthEvent.DismissError -> update { copy(error = null) }
            AuthEvent.Logout -> logout()
            AuthEvent.ScenarioChanged -> resetForScenarioChange()
        }
    }

    // ------------------------------------------------------------------ açılış

    /**
     * Açılış: diskteki oturumu çözer.
     *
     * Profil yükleme `perform` ile sarmalı — sunucuya ulaşılamadığında (uçak modu,
     * kapalı sunucu) uygulamanın ÇÖKMEMESİ gerekir. Böyle bir durumda `Launch`
     * adımında kalınır ve kullanıcıya tekrar deneme sunulur: geçici bir ağ hatası
     * yüzünden geçerli bir oturumu atmak, kullanıcıyı sebepsiz yeniden giriş yapmaya
     * zorlamak olurdu. Oturumu gerçekten geçersiz kılan token hataları `capture`
     * tarafından zaten çıkışa çevriliyor.
     */
    private fun start() {
        viewModelScope.launch {
            if (container.tokens.hasSession()) {
                // Geçerli oturumu olan kullanıcı gecikmeyle CEZALANDIRILMAZ.
                try {
                    loadProfileAndRoute()
                } catch (error: ApiError) {
                    capture(error)
                }
            } else {
                // Splash titremesini önleyen gecikme YALNIZ buraya uygulanır.
                delay(SPLASH_SETTLE_MILLIS)
                // Gecikme boyunca akış ilerlemiş olabilir (otomatik doldurma, hızlı
                // dokunuş). Hâlâ Launch'taysak geçiş yap; değilse kullanıcının
                // bulunduğu adımı EZME.
                if (state.value.step == AuthStep.Launch) goTo(AuthStep.Identifier)
            }
        }
    }

    // ------------------------------------------------------- tanımlayıcı/parola

    private fun switchIdentifierMode() =
        update {
            copy(
                identifierMode =
                    if (identifierMode == IdentifierMode.Phone) IdentifierMode.Email else IdentifierMode.Phone,
                error = null,
            )
        }

    private fun submitIdentifier() {
        if (!state.value.canSubmitIdentifier) return
        goTo(AuthStep.Password)
    }

    private fun submitPassword() {
        val current = state.value
        if (!current.canSubmitPassword) return

        perform {
            didUsePasswordLogin = true
            val response =
                container.auth.login(
                    email = current.email.takeIf { current.identifierMode == IdentifierMode.Email },
                    phone = current.phoneE164.takeIf { current.identifierMode == IdentifierMode.Phone },
                    password = current.password,
                    deviceLabel = DeviceLabel.current(),
                )
            handle(response.outcome())
        }
    }

    // ------------------------------------------------------------------ yönlendirme

    private suspend fun handle(outcome: LoginOutcome) {
        when (outcome) {
            is LoginOutcome.Success -> {
                container.tokens.save(outcome.tokens)
                container.tokens.warmUp()
                resetChallenge()
                loadProfileAndRoute()
            }

            is LoginOutcome.NeedsTenantSelection -> {
                challengeToken = outcome.challengeToken
                goTo(AuthStep.TenantSelect(outcome.tenants))
            }

            is LoginOutcome.NeedsMfa -> {
                challengeToken = outcome.challengeToken
                if (outcome.challenge.configured) {
                    goTo(AuthStep.Totp(outcome.challenge.allowsBackupCode))
                } else {
                    // Yumurta-tavuk: 2FA zorunlu ama kurulmamış. `mfa` ara token'ı
                    // yalnız setup/enable uçlarını açar (§4.7).
                    beginTotpSetup()
                }
            }
        }
    }

    private suspend fun loadProfileAndRoute() {
        val me = container.auth.me()
        profile = me
        container.tokens.setTenant(me.tenantId)

        if (!me.user.phoneVerified) {
            update { copy(phoneToVerify = me.user.phone.orEmpty()) }
            goTo(AuthStep.PhoneVerification(phone = me.user.phone, codeExpiresAt = null))
            return
        }

        routeToBranchOrFinish(me)
    }

    private suspend fun routeToBranchOrFinish(me: MeResponse) {
        val all = container.auth.branches()
        val visible = if (me.tenantWide) all else all.filter { me.branchIds.contains(it.id) }
        visibleBranches = visible

        val saved = container.tokens.branchId()
        // Kaydedilmiş şube artık görünmüyorsa DÜŞÜRÜLÜR: aksi hâlde sonraki her istek
        // 403 BRANCH_FORBIDDEN alır ve kullanıcı sebebini anlayamaz.
        if (saved != null && visible.none { it.id == saved }) {
            container.tokens.setBranch(null)
        }

        val effective = container.tokens.branchId()
        if (visible.size > 1 && effective == null) {
            goTo(AuthStep.BranchSelect(visible))
            return
        }
        if (effective == null) {
            visible.firstOrNull()?.let { container.tokens.setBranch(it.id) }
        }

        offerPasskeyOrFinish()
    }

    private fun offerPasskeyOrFinish() {
        val user = profile?.user
        val eligible =
            passkey.isAvailable() && didUsePasswordLogin && user?.hasPassword == true
        if (eligible) {
            goTo(AuthStep.PasskeyEnrollOffer)
        } else {
            finishAuthentication()
        }
    }

    private fun finishAuthentication() {
        val me = profile ?: return
        viewModelScope.launch {
            val session =
                AppSession(
                    profile = me,
                    branches = visibleBranches,
                    activeBranchId = container.tokens.branchId(),
                )
            goTo(AuthStep.Authenticated(session))
        }
    }

    // ------------------------------------------------------------------ MFA

    private fun submitSecondFactor(code: String) {
        val token = challengeToken ?: return
        perform {
            val response = container.auth.verifyMfa(token, code, DeviceLabel.current())
            handle(response.outcome())
        }
    }

    private fun beginTotpSetup() {
        val token = challengeToken ?: return
        perform {
            val setup = container.auth.totpSetup(token)
            goTo(AuthStep.TotpSetup(secret = setup.secret, otpauthUri = setup.otpauthUri))
        }
    }

    private fun confirmTotpSetup() {
        val token = challengeToken ?: return
        val code = state.value.totpSetupCode
        perform {
            val codes = container.auth.totpEnable(token, code)
            goTo(AuthStep.BackupCodesDisplay(codes))
        }
    }

    /**
     * Yedek kodlar gösterildikten sonra **yeni** bir TOTP kodu istenir: kurulum kodu
     * sunucuda yakıldı (replay koruması) ve aynısını tekrar göndermek başarısız olurdu.
     */
    private fun finishBackupCodesDisplay() {
        update { copy(mfaCode = "", totpSetupCode = "") }
        goTo(AuthStep.Totp(allowsBackupCode = true))
    }

    // ------------------------------------------------------------ kiracı / şube

    private fun selectTenant(tenant: TenantOption) {
        val token = challengeToken ?: return
        perform {
            val response = container.auth.selectTenant(token, tenant.id)
            handle(response.outcome())
        }
    }

    private fun selectBranch(branch: BranchSummary) {
        perform {
            container.tokens.setBranch(branch.id)
            offerPasskeyOrFinish()
        }
    }

    // ------------------------------------------------------------ kurtarma/telefon

    private fun submitForgotPassword() {
        val email = state.value.forgotPasswordEmail
        perform {
            container.auth.forgotPassword(email)
            goTo(AuthStep.ForgotPasswordSent)
        }
    }

    private fun sendPhoneCode() {
        val phone = state.value.phoneToVerify
        perform {
            val started = container.auth.startPhoneVerification(phone)
            goTo(AuthStep.PhoneVerification(phone = started.phone, codeExpiresAt = started.expiresAt))
        }
    }

    private fun submitPhoneCode() {
        val code = state.value.smsCode
        perform {
            container.auth.verifyPhone(code)
            val me = profile
            if (me != null) {
                profile = container.auth.me()
                routeToBranchOrFinish(profile!!)
            } else {
                loadProfileAndRoute()
            }
        }
    }

    private fun changePhoneNumber() {
        update { copy(smsCode = "") }
        goTo(AuthStep.PhoneVerification(phone = null, codeExpiresAt = null))
    }

    // ------------------------------------------------------------------ passkey

    private fun signInWithPasskey() {
        if (!passkey.isAvailable()) return
        perform {
            val options = container.auth.passkeyAssertionOptions()
            _effects.send(AuthEffect.RequestPasskey(options, AuthEffect.PasskeyMode.Assert))
        }
    }

    private fun enrollPasskey() {
        if (!passkey.isAvailable()) {
            finishAuthentication()
            return
        }
        perform {
            val options = container.auth.passkeyRegistrationOptions()
            _effects.send(AuthEffect.RequestPasskey(options, AuthEffect.PasskeyMode.Create))
        }
    }

    private fun handlePasskeyOutcome(outcome: PasskeyOutcome) {
        when (outcome) {
            // Kullanıcı iptal etti ya da kayıtlı passkey yok: sessizce parola yolunda kal.
            PasskeyOutcome.Cancelled, PasskeyOutcome.NoCredential -> update { copy(isBusy = false) }

            PasskeyOutcome.Unsupported ->
                showError(AuthErrorState("Cihazınızda passkey desteği bulunamadı."))

            is PasskeyOutcome.Misconfigured ->
                // GELİŞTİRME hatası: kullanıcıya "cihazınız desteklemiyor" DENMEZ.
                showError(AuthErrorState("Passkey şu anda kullanılamıyor. Parolanızla giriş yapabilirsiniz."))

            is PasskeyOutcome.Failed -> showError(AuthErrorState("Passkey doğrulanamadı."))

            is PasskeyOutcome.Success -> perform {
                val response = container.auth.passkeyVerify(outcome.responseJson, DeviceLabel.current())
                handle(response.outcome())
            }
        }
    }

    // ------------------------------------------------------------------ geri

    /**
     * Geri tablosu. Ayrıntılı gerekçe [AuthBackHandler]'da.
     *
     * `BranchSelect` ve `PhoneVerification` adımlarında token ZATEN diskte olduğu için
     * geri `logout()` çağırır. iOS'ta bu bir hata: orada `goBack()` yalnız `step`
     * değiştiriyor ve sonraki soğuk açılış kullanıcıyı çıkışı olmayan telefon doğrulama
     * ekranına kilitler.
     */
    private fun goBack() {
        when (state.value.step) {
            AuthStep.Password -> {
                update { copy(password = "", error = null) }
                goTo(AuthStep.Identifier)
            }

            is AuthStep.Totp, AuthStep.BackupCode, is AuthStep.TotpSetup -> {
                resetChallenge()
                goTo(AuthStep.Identifier)
            }

            AuthStep.ForgotPasswordEmail -> goTo(AuthStep.Password)

            AuthStep.ForgotPasswordSent -> {
                resetInputs()
                goTo(AuthStep.Identifier)
            }

            is AuthStep.TenantSelect, is AuthStep.BranchSelect, is AuthStep.PhoneVerification -> logout()

            AuthStep.PasskeyEnrollOffer -> finishAuthentication()

            // BackupCodesDisplay geri tuşunu yutar (kodlar bir kez gösterilir),
            // Launch/Identifier'da handler hiç kurulmaz — sistem geri tuşu çıkar.
            else -> Unit
        }
    }

    // ------------------------------------------------------------------ oturum

    private fun logout() {
        viewModelScope.launch {
            runCatching { container.auth.logout() }
            forceLogout()
        }
    }

    private suspend fun forceLogout() {
        container.tokens.clear()
        resetChallenge()
        profile = null
        visibleBranches = emptyList()
        didUsePasswordLogin = false
        _state.value = AuthUiState(step = AuthStep.Identifier)
    }

    /** Yalnız debug: senaryo değişince akış baştan sürülebilmeli. */
    private fun resetForScenarioChange() {
        viewModelScope.launch { forceLogout() }
    }

    // ------------------------------------------------------------------ yardımcı

    private fun perform(block: suspend () -> Unit) {
        viewModelScope.launch {
            update { copy(isBusy = true, error = null) }
            try {
                block()
                update { copy(isBusy = false) }
            } catch (error: ApiError) {
                capture(error)
            }
        }
    }

    private fun capture(error: ApiError) {
        if (error.invalidatesSession) {
            viewModelScope.launch { forceLogout() }
            return
        }
        showError(
            AuthErrorState(
                message = error.displayMessage,
                isRetryable = error.isRetryable,
                supportReference = error.supportReference,
                fieldErrors = error.fieldErrors,
            ),
        )
    }

    private fun showError(error: AuthErrorState) = update { copy(isBusy = false, error = error) }

    private fun resetChallenge() {
        challengeToken = null
        update { copy(mfaCode = "", backupCode = "", totpSetupCode = "") }
    }

    private fun resetInputs() =
        update {
            copy(password = "", mfaCode = "", backupCode = "", smsCode = "", forgotPasswordEmail = "")
        }

    private fun goTo(step: AuthStep) =
        update {
            copy(
                step = step,
                isBusy = false,
                error = null,
                canGoBack = canGoBackFrom(step),
                offersPasskeyShortcut = step is AuthStep.Identifier && passkey.isAvailable(),
            )
        }

    private inline fun update(transform: AuthUiState.() -> AuthUiState) {
        _state.value = _state.value.transform()
    }

    companion object {
        /**
         * Oturumu olmayan kullanıcıda splash titremesini önler. Oturumu OLANA
         * uygulanmaz — geçerli bir oturum için beklemek cezalandırmaktır.
         */
        const val SPLASH_SETTLE_MILLIS = 450L

        /** Geri tuşunun anlamlı olduğu adımlar. Saf fonksiyon: testte doğrudan sürülür. */
        fun canGoBackFrom(step: AuthStep): Boolean =
            when (step) {
                AuthStep.Password,
                is AuthStep.Totp,
                AuthStep.BackupCode,
                is AuthStep.TotpSetup,
                AuthStep.ForgotPasswordEmail,
                AuthStep.ForgotPasswordSent,
                -> true
                else -> false
            }

        val Factory =
            viewModelFactory {
                initializer {
                    val app =
                        this[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as KlinaraApplication
                    // ViewModel bir CompositionLocal'a ASLA dokunmaz; container
                    // CreationExtras üzerinden gelir.
                    AuthFlowViewModel(app.container)
                }
            }
    }
}

/** Sunucuya gönderilen cihaz etiketi — oturum listesinde kullanıcı kendi cihazını tanısın. */
internal object DeviceLabel {
    fun current(): String = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim()
}
