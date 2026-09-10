package com.klinara.android.features.shell

import app.cash.turbine.test
import com.klinara.android.services.auth.AuthTokens
import com.klinara.android.services.auth.InMemorySessionCipher
import com.klinara.android.services.auth.MockAuthService
import com.klinara.android.services.auth.TokenStore
import com.klinara.android.services.mock.MockScenario
import com.klinara.android.services.networking.FakePreferencesDataStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SessionViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private lateinit var tokens: TokenStore

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        tokens = TokenStore(FakePreferencesDataStore(), InMemorySessionCipher())
    }

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private suspend fun viewModel(scenario: MockScenario = MockScenario.MultiBranch): SessionViewModel {
        // setBranch var olan bir oturumu günceller; oturum yoksa sessizce hiçbir şey
        // yapmaz. Gerçek akışta token giriş sırasında yazılmış oluyor.
        tokens.save(AuthTokens(accessToken = "a", refreshToken = "r", expiresIn = 900))
        return SessionViewModel(
            initial =
                ShellSessions.forRole("manager", listOf(ShellSessions.nisantasi, ShellSessions.bodrum)),
            auth = MockAuthService(scenario, latencyEnabled = false),
            tokens = tokens,
        )
    }

    @Test
    @DisplayName("Şube değişimi ÖNCE token deposuna yazılır — yoksa istek eski şubeye gider")
    fun switchBranchWritesToTokenStore() =
        runTest {
            val model = viewModel()

            model.switchBranch(ShellSessions.bodrum)
            advanceUntilIdle()

            assertEquals(ShellSessions.bodrum.id, tokens.branchId())
            assertEquals(ShellSessions.bodrum.id, model.session.value.activeBranchId)
            assertEquals(ShellSessions.bodrum, model.session.value.activeBranch)
        }

    @Test
    @DisplayName("Şube değişimi generation sayacını artırır")
    fun switchBranchBumpsGeneration() =
        runTest {
            val model = viewModel()

            model.branchGeneration.test {
                assertEquals(0, awaitItem())
                model.switchBranch(ShellSessions.bodrum)
                advanceUntilIdle()
                assertEquals(1, awaitItem())
            }
        }

    @Test
    @DisplayName("Aynı şube tekrar seçilirse hiçbir şey olmaz — boşuna yeniden çekme yok")
    fun reselectingTheSameBranchIsANoOp() =
        runTest {
            val model = viewModel()

            model.switchBranch(ShellSessions.nisantasi)
            advanceUntilIdle()

            assertEquals(0, model.branchGeneration.value)
        }

    @Test
    @DisplayName("reloadProfile ağ hatasında oturumu DÜŞÜRMEZ")
    fun reloadProfileSurvivesNetworkFailure() =
        runTest {
            val model = viewModel(MockScenario.NetworkError)
            val before = model.session.value.profile

            model.reloadProfile()
            advanceUntilIdle()

            assertEquals(
                before,
                model.session.value.profile,
                "Geçici bir ağ hatası uğruna elimizdeki geçerli profili atmak, " +
                    "kullanıcıyı sebepsiz yere yeniden giriş yapmaya zorlamaktı.",
            )
        }

    @Test
    @DisplayName("reloadProfile başarılıysa izinler tazelenir")
    fun reloadProfileRefreshesPermissions() =
        runTest {
            val model = viewModel(MockScenario.PractitionerScope)

            model.reloadProfile()
            advanceUntilIdle()

            assertEquals(listOf("practitioner"), model.session.value.profile.roles)
        }
}
