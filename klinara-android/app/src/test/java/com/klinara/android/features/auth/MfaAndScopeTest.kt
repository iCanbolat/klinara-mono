package com.klinara.android.features.auth

import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.AuthTokens
import com.klinara.android.services.auth.InMemorySessionCipher
import com.klinara.android.services.auth.MockAuthService
import com.klinara.android.services.auth.TokenStore
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.mock.MockScenario
import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.FakePreferencesDataStore
import com.klinara.android.services.networking.OkHttpFactory
import com.klinara.android.services.passkey.UnavailablePasskeyService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.Serializable
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@Serializable
private data class Ping(val ok: Boolean = true)

/**
 * A1.2 ve A1.3'ün kendi "Bitti" ölçütleri.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MfaAndScopeTest {
    private val dispatcher = StandardTestDispatcher()
    private lateinit var tokens: TokenStore

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        tokens = TokenStore(FakePreferencesDataStore(), InMemorySessionCipher())
    }

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel(scenario: MockScenario): AuthFlowViewModel {
        val mock = MockAuthService(scenario, latencyEnabled = false)
        return AuthFlowViewModel(
            ServiceContainer.testing(mock, tokens, MutableSharedFlow(extraBufferCapacity = 1), mock),
            UnavailablePasskeyService(),
        )
    }

    private fun AuthFlowViewModel.signIn() {
        onEvent(AuthEvent.Start)
        dispatcher.scheduler.advanceUntilIdle()
        onEvent(AuthEvent.PhoneChanged("+905321234567"))
        onEvent(AuthEvent.SubmitIdentifier)
        onEvent(AuthEvent.PasswordChanged("cok-gizli-parola"))
        onEvent(AuthEvent.SubmitPassword)
        dispatcher.scheduler.advanceUntilIdle()
    }

    // ------------------------------------------------------------------ A1.2

    @Test
    @DisplayName("parola → TOTP → oturum")
    fun passwordThenTotpReachesSession() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.PasswordThenTotp)
            vm.signIn()
            assertTrue(vm.state.value.step is AuthStep.Totp)

            vm.onEvent(AuthEvent.MfaCodeChanged("482913"))
            vm.onEvent(AuthEvent.SubmitMfaCode)
            dispatcher.scheduler.advanceUntilIdle()

            assertTrue(vm.state.value.step is AuthStep.Authenticated)
        }

    @Test
    @DisplayName("Yedek kod aynı ucu kullanır ve oturuma çıkar")
    fun backupCodeReachesSession() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.PasswordThenTotp)
            vm.signIn()

            vm.onEvent(AuthEvent.UseBackupCode)
            assertEquals(AuthStep.BackupCode, vm.state.value.step)

            vm.onEvent(AuthEvent.BackupCodeChanged("4f2a-9c1e"))
            vm.onEvent(AuthEvent.SubmitBackupCode)
            dispatcher.scheduler.advanceUntilIdle()

            assertTrue(vm.state.value.step is AuthStep.Authenticated)
        }

    @Test
    @DisplayName("Yanlış kod: ekran TOTP'de kalır, mesaj gösterilir, oturum açılmaz")
    fun wrongMfaCodeKeepsUserOnStep() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.PasswordThenTotp)
            vm.signIn()

            vm.onEvent(AuthEvent.MfaCodeChanged("000000"))
            vm.onEvent(AuthEvent.SubmitMfaCode)
            dispatcher.scheduler.advanceUntilIdle()

            assertTrue(vm.state.value.step is AuthStep.Totp)
            assertEquals("Doğrulama kodu hatalı.", vm.state.value.error?.message)
            assertNull(tokens.accessToken())
        }

    @Test
    @DisplayName("Zorunlu kurulum akışı: setup → yedek kodlar → YENİ kod istenir")
    fun mandatorySetupFlowRequiresFreshCode() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.MfaRequiredNotConfigured)
            vm.signIn()
            assertTrue(vm.state.value.step is AuthStep.TotpSetup)

            vm.onEvent(AuthEvent.TotpSetupCodeChanged("482913"))
            vm.onEvent(AuthEvent.ConfirmTotpSetup)
            dispatcher.scheduler.advanceUntilIdle()

            val display = vm.state.value.step
            assertTrue(display is AuthStep.BackupCodesDisplay)
            assertEquals(10, (display as AuthStep.BackupCodesDisplay).codes.size)

            vm.onEvent(AuthEvent.FinishBackupCodesDisplay)
            dispatcher.scheduler.advanceUntilIdle()

            // Kurulum kodu sunucuda YAKILDI (replay koruması); yeni bir kod istenmeli.
            assertTrue(vm.state.value.step is AuthStep.Totp)
            assertEquals("", vm.state.value.mfaCode, "Kurulum kodu taşınmamalı")
        }

    // ------------------------------------------------------------------ A1.3

    @Test
    @DisplayName("Kiracı seçimi oturuma çıkarır")
    fun tenantSelectionCompletesLogin() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.MultiTenant)
            vm.signIn()

            val step = vm.state.value.step as AuthStep.TenantSelect
            vm.onEvent(AuthEvent.SelectTenant(step.options.first()))
            dispatcher.scheduler.advanceUntilIdle()

            assertTrue(vm.state.value.step is AuthStep.Authenticated)
        }

    @Test
    @DisplayName("Seçilen şube TokenStore'a yazılır ve oturumda görünür")
    fun branchSelectionScopesSession() =
        runTest(dispatcher) {
            val vm = viewModel(MockScenario.MultiBranch)
            vm.signIn()

            val step = vm.state.value.step as AuthStep.BranchSelect
            val chosen = step.branches[1]
            vm.onEvent(AuthEvent.SelectBranch(chosen))
            dispatcher.scheduler.advanceUntilIdle()

            assertEquals(chosen.id, tokens.branchId())
            val session = (vm.state.value.step as AuthStep.Authenticated).session
            assertEquals(chosen.id, session.activeBranchId)
            assertEquals(chosen.name, session.activeBranch?.name)
        }

    @Test
    @DisplayName("Görünmez olan kaydedilmiş şube DÜŞÜRÜLÜR — 403 BRANCH_FORBIDDEN koruması")
    fun staleBranchIsDropped() =
        runTest(dispatcher) {
            // Kullanıcı daha önce Bodrum'u seçmiş; artık yalnız Nişantaşı'na erişimi var.
            tokens.save(AuthTokens("a", "r", expiresIn = 900))
            tokens.setBranch(com.klinara.android.services.mock.MockIds.BRANCH_BODRUM)

            val vm = viewModel(MockScenario.PasswordOnly)
            vm.onEvent(AuthEvent.Start)
            dispatcher.scheduler.advanceUntilIdle()

            assertNotEquals(
                com.klinara.android.services.mock.MockIds.BRANCH_BODRUM,
                tokens.branchId(),
                "Görünmeyen şube kalsaydı sonraki her istek 403 alırdı",
            )
            assertEquals(com.klinara.android.services.mock.MockIds.BRANCH_NISANTASI, tokens.branchId())
        }
}

/**
 * A1.3'ün kablo üzerindeki ispatı: şube değişimi **bir sonraki isteğin** kapsamını
 * değiştiriyor mu? Bunu mock servisle değil gerçek `ApiClient` ile doğrulamak gerekir,
 * çünkü kırılabilecek yer `HeaderInterceptor`.
 */
class BranchScopeHeaderTest {
    @Test
    @DisplayName("setBranch sonrası bir sonraki istek YENİ X-Branch-Id taşır")
    fun branchChangeScopesNextRequest() =
        runTest {
            val server = MockWebServer()
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            try {
                val tokens = TokenStore(FakePreferencesDataStore(), InMemorySessionCipher())
                tokens.save(AuthTokens("access-1", "refresh-1", expiresIn = 900))
                tokens.setBranch("branch-a")
                tokens.warmUp()

                val baseUrl = server.url("/api/v1/")
                val clients = OkHttpFactory.create(tokens, scope, onExpired = {}, baseUrl = baseUrl)
                val client = ApiClient(clients.api, baseUrl)

                server.enqueue(MockResponse.Builder().code(200).body("""{"ok":true}""").build())
                client.send<Ping>(ApiRequest.get("appointments"))
                assertEquals("branch-a", server.takeRequest().headers["X-Branch-Id"])

                tokens.setBranch("branch-b")

                server.enqueue(MockResponse.Builder().code(200).body("""{"ok":true}""").build())
                client.send<Ping>(ApiRequest.get("appointments"))
                assertEquals(
                    "branch-b",
                    server.takeRequest().headers["X-Branch-Id"],
                    "Şube değişimi ANINDA sonraki isteğe yansımalı; aksi hâlde kullanıcı " +
                        "başka şubenin verisini görür",
                )
            } finally {
                scope.cancel()
                server.close()
            }
        }
}
