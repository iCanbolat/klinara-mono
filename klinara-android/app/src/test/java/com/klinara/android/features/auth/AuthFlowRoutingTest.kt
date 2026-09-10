package com.klinara.android.features.auth

import app.cash.turbine.test
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.MockAuthService
import com.klinara.android.services.auth.TokenStore
import com.klinara.android.services.mock.MockScenario
import com.klinara.android.services.networking.FakePreferencesDataStore
import com.klinara.android.services.auth.InMemorySessionCipher
import com.klinara.android.services.passkey.PasskeyOutcome
import com.klinara.android.services.passkey.PasskeyService
import com.klinara.android.services.passkey.UnavailablePasskeyService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * Yönlendirme mantığının testleri — A1.1'in "Bitti" ölçütü.
 *
 * Her `MockScenario` dalı buradan sürülüyor; geliştirici menüsü elle sürmek için var,
 * regresyon koruması bu dosya.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AuthFlowRoutingTest {
    private val dispatcher = StandardTestDispatcher()
    private lateinit var tokens: TokenStore
    private lateinit var sessionExpired: MutableSharedFlow<Unit>

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        tokens = TokenStore(FakePreferencesDataStore(), InMemorySessionCipher())
        sessionExpired = MutableSharedFlow(extraBufferCapacity = 1)
    }

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel(
        scenario: MockScenario = MockScenario.PasswordOnly,
        passkey: PasskeyService = UnavailablePasskeyService(),
    ): AuthFlowViewModel {
        val mock = MockAuthService(scenario, latencyEnabled = false)
        val container =
            ServiceContainer.testing(
                auth = mock,
                tokens = tokens,
                sessionExpired = sessionExpired,
                mockAuth = mock,
            )
        return AuthFlowViewModel(container, passkey)
    }

    private suspend fun AuthFlowViewModel.signIn(mode: IdentifierMode = IdentifierMode.Phone) {
        onEvent(AuthEvent.Start)
        dispatcher.scheduler.advanceUntilIdle()
        when (mode) {
            IdentifierMode.Phone -> onEvent(AuthEvent.PhoneChanged("+905321234567"))
            IdentifierMode.Email -> {
                onEvent(AuthEvent.SwitchIdentifierMode)
                onEvent(AuthEvent.EmailChanged("ayse@klinik.com"))
            }
        }
        onEvent(AuthEvent.SubmitIdentifier)
        onEvent(AuthEvent.PasswordChanged("cok-gizli-parola"))
        onEvent(AuthEvent.SubmitPassword)
    }

    // ------------------------------------------------------------------ açılış

    @Test
    @DisplayName("Oturum yokken tanımlayıcıya düşer")
    fun startsAtIdentifierWithoutSession() =
        runTest(dispatcher) {
            val vm = viewModel()
            vm.onEvent(AuthEvent.Start)
            dispatcher.scheduler.advanceUntilIdle()

            assertEquals(AuthStep.Identifier, vm.state.value.step)
        }

    @Test
    @DisplayName("Süreç ölümü sonrası TokenStore tek otoritedir — diskte oturum varsa doğrudan içeri")
    fun resolvesSessionFromDiskAfterProcessDeath() =
        runTest(dispatcher) {
            tokens.save(com.klinara.android.services.auth.AuthTokens("a", "r", expiresIn = 900))

            val vm = viewModel()
            vm.onEvent(AuthEvent.Start)
            dispatcher.scheduler.advanceUntilIdle()

            // Yarım kalmış bir MFA challenge'ı bilerek kayboldu; disk otorite.
            assertTrue(vm.state.value.step is AuthStep.Authenticated)
        }

    @Test
    @DisplayName("Açılışta sunucuya ulaşılamazsa ÇÖKMEZ: Launch'ta kalır, oturumu ATMAZ")
    fun sessionRestoreFailureDoesNotCrashOrDiscardSession() =
        runTest(dispatcher) {
            // Diskte geçerli bir oturum var ama sunucu ulaşılamaz durumda.
            tokens.save(com.klinara.android.services.auth.AuthTokens("a", "r", expiresIn = 900))
            val vm = viewModel(MockScenario.NetworkError)

            vm.onEvent(AuthEvent.Start)
            dispatcher.scheduler.advanceUntilIdle()

            assertEquals(AuthStep.Launch, vm.state.value.step, "Kullanıcı tekrar deneyebilmeli")
            assertNotNull(vm.state.value.error)
            assertTrue(vm.state.value.error!!.isRetryable)
            assertNotNull(
                tokens.accessToken(),
                "Geçici bir ağ hatası geçerli bir oturumu ATMAMALI",
            )
        }

    @Test
    @DisplayName("Tekrar dene: sunucu geri gelince oturum çözülür")
    fun retryAfterNetworkFailureResolvesSession() =
        runTest(dispatcher) {
            tokens.save(com.klinara.android.services.auth.AuthTokens("a", "r", expiresIn = 900))
            val mock = MockAuthService(MockScenario.NetworkError, latencyEnabled = false)
            val vm =
                AuthFlowViewModel(
                    ServiceContainer.testing(mock, tokens, sessionExpired, mock),
                    UnavailablePasskeyService(),
                )

            vm.onEvent(AuthEvent.Start)
            dispatcher.scheduler.advanceUntilIdle()
            assertEquals(AuthStep.Launch, vm.state.value.step)

            // Sunucu geri geldi.
            mock.scenario = MockScenario.PasswordOnly
            vm.onEvent(AuthEvent.RetrySessionRestore)
            dispatcher.scheduler.advanceUntilIdle()

            assertTrue(vm.state.value.step is AuthStep.Authenticated)
        }

    // ------------------------------------------------------------------ giriş

    @Test
    @DisplayName("Parola girişi doğrudan oturuma çıkar")
    fun passwordOnlyReachesSession() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.PasswordOnly)
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()

            val step = vm.state.value.step
            assertTrue(step is AuthStep.Authenticated, "Beklenen Authenticated, gelen $step")
            assertNotNull(tokens.accessToken(), "Token diske yazılmalı")
        }

    @Test
    @DisplayName("2FA kuruluysa TOTP adımına gider")
    fun configuredMfaRoutesToTotp() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.PasswordThenTotp)
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()

            val step = vm.state.value.step
            assertTrue(step is AuthStep.Totp)
            assertTrue((step as AuthStep.Totp).allowsBackupCode)
        }

    @Test
    @DisplayName("2FA zorunlu ama kurulmamışsa KURULUM adımına gider — yumurta-tavuk akışı")
    fun mandatoryMfaWithoutSetupRoutesToSetup() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.MfaRequiredNotConfigured)
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()

            val step = vm.state.value.step
            assertTrue(step is AuthStep.TotpSetup, "Beklenen TotpSetup, gelen $step")
            assertTrue((step as AuthStep.TotpSetup).otpauthUri.startsWith("otpauth://"))
        }

    @Test
    @DisplayName("Çok kiracılı hesap kiracı seçimine gider")
    fun multiTenantRoutesToTenantSelect() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.MultiTenant)
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()

            val step = vm.state.value.step
            assertTrue(step is AuthStep.TenantSelect)
            assertEquals(2, (step as AuthStep.TenantSelect).options.size)
        }

    @Test
    @DisplayName("Çok şubeli hesap şube seçimine gider; tek şube ATLANIR")
    fun branchSelectionOnlyWhenAmbiguous() =
        runTest(dispatcher) {
            val many = viewModel(MockScenario.MultiBranch)
            many.signIn()
            dispatcher.scheduler.advanceUntilIdle()
            assertTrue(many.state.value.step is AuthStep.BranchSelect)

            tokens.clear()
            val one = viewModel(MockScenario.PasswordOnly)
            one.signIn()
            dispatcher.scheduler.advanceUntilIdle()
            assertTrue(one.state.value.step is AuthStep.Authenticated, "Tek şubede seçim sorulmamalı")
        }

    @Test
    @DisplayName("Doğrulanmamış telefon şube seçiminden ÖNCE gelir")
    fun unverifiedPhoneBlocksBeforeBranch() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.UnverifiedPhone)
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()

            assertTrue(vm.state.value.step is AuthStep.PhoneVerification)
        }

    // ------------------------------------------------------------------ hatalar

    @Test
    @DisplayName("Hatalı parola: ekranda mesaj var, oturum YOK")
    fun wrongPasswordShowsErrorAndKeepsUserOut() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.WrongPassword)
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()

            assertEquals(AuthStep.Password, vm.state.value.step)
            assertEquals("Girdiğiniz bilgiler hatalı.", vm.state.value.error?.message)
            assertNull(tokens.accessToken())
        }

    @Test
    @DisplayName("Kilitli hesap ve hız sınırı AYRI mesajlar verir")
    fun lockedAndRateLimitedAreDistinct() =
        runTest(dispatcher) {
            val locked = viewModel(MockScenario.AccountLocked)
            locked.signIn()
            dispatcher.scheduler.advanceUntilIdle()

            tokens.clear()
            val limited = viewModel(MockScenario.RateLimited)
            limited.signIn()
            dispatcher.scheduler.advanceUntilIdle()

            val lockedMessage = locked.state.value.error?.message
            val limitedMessage = limited.state.value.error?.message
            assertNotNull(lockedMessage)
            assertNotNull(limitedMessage)
            assertTrue(lockedMessage != limitedMessage, "İki farklı durum aynı mesajı vermemeli")
            assertTrue(limited.state.value.error!!.isRetryable, "Hız sınırı tekrar denenebilir")
            assertFalse(locked.state.value.error!!.isRetryable, "Kilitli hesabı tekrar denemek fayda etmez")
        }

    @Test
    @DisplayName("Ağ hatası tekrar denenebilir olarak işaretlenir")
    fun networkErrorIsRetryable() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.NetworkError)
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()

            assertTrue(vm.state.value.error!!.isRetryable)
        }

    // ------------------------------------------------------------------ geri

    @Test
    @DisplayName("canGoBack SAF bir fonksiyondur ve tabloyla eşleşir")
    fun backAvailabilityMatchesTable() {
        val canGoBack =
            listOf(
                AuthStep.Password,
                AuthStep.Totp(allowsBackupCode = true),
                AuthStep.BackupCode,
                AuthStep.TotpSetup("s", "u"),
                AuthStep.ForgotPasswordEmail,
                AuthStep.ForgotPasswordSent,
            )
        canGoBack.forEach {
            assertTrue(AuthFlowViewModel.canGoBackFrom(it), "$it geri gidebilmeli")
        }

        val cannot =
            listOf(
                AuthStep.Launch,
                AuthStep.Identifier,
                AuthStep.BackupCodesDisplay(listOf("a-b")),
                AuthStep.TenantSelect(emptyList()),
                AuthStep.BranchSelect(emptyList()),
                AuthStep.PhoneVerification(null, null),
                AuthStep.PasskeyEnrollOffer,
            )
        cannot.forEach {
            assertFalse(AuthFlowViewModel.canGoBackFrom(it), "$it için geri düğmesi ÇİZİLMEMELİ")
        }
    }

    @Test
    @DisplayName("Paroladan geri: tanımlayıcıya döner ve parolayı TEMİZLER")
    fun backFromPasswordClearsIt() =
        runTest(dispatcher) {
            val vm = viewModel()
            vm.onEvent(AuthEvent.Start)
            dispatcher.scheduler.advanceUntilIdle()
            vm.onEvent(AuthEvent.PhoneChanged("+905321234567"))
            vm.onEvent(AuthEvent.SubmitIdentifier)
            vm.onEvent(AuthEvent.PasswordChanged("cok-gizli-parola"))
            dispatcher.scheduler.advanceUntilIdle()

            vm.onEvent(AuthEvent.Back)
            dispatcher.scheduler.advanceUntilIdle()

            assertEquals(AuthStep.Identifier, vm.state.value.step)
            assertEquals("", vm.state.value.password, "Parola bellekte kalmamalı")
        }

    @Test
    @DisplayName("TOTP'den geri: challenge sıfırlanır, yarım kimlikle takılma olmaz")
    fun backFromTotpResetsChallenge() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.PasswordThenTotp)
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()

            vm.onEvent(AuthEvent.Back)
            dispatcher.scheduler.advanceUntilIdle()

            assertEquals(AuthStep.Identifier, vm.state.value.step)
            assertEquals("", vm.state.value.mfaCode)
        }

    @Test
    @DisplayName("Şube seçiminden geri TOKEN'LARI TEMİZLER — iOS'ta canlı olan hata")
    fun backFromBranchSelectClearsTokens() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.MultiBranch)
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()
            assertTrue(vm.state.value.step is AuthStep.BranchSelect)
            assertNotNull(tokens.accessToken(), "Bu adımda token zaten diskte")

            vm.onEvent(AuthEvent.Back)
            dispatcher.scheduler.advanceUntilIdle()

            assertEquals(AuthStep.Identifier, vm.state.value.step)
            assertNull(
                tokens.accessToken(),
                "Token kalsaydı sonraki soğuk açılış kullanıcıyı çıkışsız bir ekrana kilitlerdi",
            )
        }

    @Test
    @DisplayName("Telefon doğrulamadan geri de TOKEN'LARI TEMİZLER")
    fun backFromPhoneVerificationClearsTokens() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.UnverifiedPhone)
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()
            assertTrue(vm.state.value.step is AuthStep.PhoneVerification)

            vm.onEvent(AuthEvent.Back)
            dispatcher.scheduler.advanceUntilIdle()

            assertEquals(AuthStep.Identifier, vm.state.value.step)
            assertNull(tokens.accessToken())
        }

    // ------------------------------------------------------------------ passkey

    @Test
    @DisplayName("Passkey kullanılamazken kayıt teklifi ATLANIR — A1.5 seam'i uykuda")
    fun passkeyOfferSkippedWhenUnavailable() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.PasswordOnly, passkey = UnavailablePasskeyService())
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()

            assertTrue(
                vm.state.value.step is AuthStep.Authenticated,
                "Kullanılamayan passkey akışı bloklamamalı",
            )
            assertFalse(vm.state.value.offersPasskeyShortcut)
        }

    @Test
    @DisplayName("Passkey kullanılabilirse parolayla girişten sonra kayıt teklif edilir")
    fun passkeyOfferShownWhenAvailable() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.PasswordOnly, passkey = AvailablePasskeyStub())
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()

            assertEquals(AuthStep.PasskeyEnrollOffer, vm.state.value.step)

            // "Şimdi değil" oturumu DÜŞÜRMEMELİ.
            vm.onEvent(AuthEvent.SkipPasskeyEnrollment)
            dispatcher.scheduler.advanceUntilIdle()
            assertTrue(vm.state.value.step is AuthStep.Authenticated)
            assertNotNull(tokens.accessToken())
        }

    // ------------------------------------------------------------------ oturum

    @Test
    @DisplayName("Sunucu oturumu iptal edince akış GİRİŞE döner ve token silinir")
    fun sessionExpiryReturnsToIdentifier() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.PasswordOnly)
            vm.signIn()
            dispatcher.scheduler.advanceUntilIdle()
            assertTrue(vm.state.value.step is AuthStep.Authenticated)

            sessionExpired.tryEmit(Unit)
            dispatcher.scheduler.advanceUntilIdle()

            assertEquals(AuthStep.Identifier, vm.state.value.step)
            assertNull(tokens.accessToken())
        }

    @Test
    @DisplayName("Durum akışı Turbine ile: Launch → Identifier → Password")
    fun stateStreamEmitsEachStep() =
        runTest(dispatcher) {
            val vm = viewModel()
            vm.state.test {
                assertEquals(AuthStep.Launch, awaitItem().step)

                vm.onEvent(AuthEvent.Start)
                dispatcher.scheduler.advanceUntilIdle()
                assertEquals(AuthStep.Identifier, awaitItem().step)

                vm.onEvent(AuthEvent.PhoneChanged("+905321234567"))
                awaitItem()
                vm.onEvent(AuthEvent.SubmitIdentifier)
                assertEquals(AuthStep.Password, awaitItem().step)

                cancelAndIgnoreRemainingEvents()
            }
        }

    @Test
    @DisplayName("Parola state'in toString'inde GÖRÜNMEZ")
    fun passwordIsRedactedInToString() {
        val state = AuthUiState(password = "cok-gizli-parola")
        assertFalse(state.toString().contains("cok-gizli"), "Parola bir log'a ya da crash raporuna düşmemeli")
        assertTrue(state.toString().contains("password=***"))
    }

    private class AvailablePasskeyStub : PasskeyService {
        override fun isAvailable() = true

        override suspend fun assert(
            optionsJson: String,
            activity: android.app.Activity,
        ) = PasskeyOutcome.Cancelled

        override suspend fun create(
            optionsJson: String,
            activity: android.app.Activity,
        ) = PasskeyOutcome.Cancelled
    }
}
