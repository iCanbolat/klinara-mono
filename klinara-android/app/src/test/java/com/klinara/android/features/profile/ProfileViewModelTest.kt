package com.klinara.android.features.profile

import com.klinara.android.services.auth.MockAuthService
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.mock.MockScenario
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProfileViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel(scenario: MockScenario = MockScenario.PasswordThenTotp) =
        ProfileViewModel(MockAuthService(scenario, latencyEnabled = false))

    @Test
    @DisplayName("TOTP durumu ve passkey listesi yükleniyor")
    fun loadsBothSections() =
        runTest {
            val model = viewModel()
            model.load()
            advanceUntilIdle()

            val totp = model.state.value.totp as Loadable.Loaded
            assertTrue(totp.value.enabled)
            assertEquals(8, totp.value.backupCodesRemaining)

            val passkeys = model.state.value.passkeys as Loadable.Loaded
            assertEquals(2, passkeys.value.size)
            assertEquals("iPhone 15 Pro", passkeys.value.first().deviceLabel)
        }

    @Test
    @DisplayName("2FA kurulmamış hesapta durum 'kapalı' — ekranın ikinci dalı da sürülüyor")
    fun reportsDisabledTotp() =
        runTest {
            val model = viewModel(MockScenario.PasswordOnly)
            model.load()
            advanceUntilIdle()

            assertEquals(false, (model.state.value.totp as Loadable.Loaded).value.enabled)
        }

    @Test
    @DisplayName("İkincil çağrılar düşse de ekran çizilebilir kalıyor")
    fun partialFailureDoesNotBlankTheScreen() =
        runTest {
            val model = viewModel(MockScenario.NetworkError)
            model.load()
            advanceUntilIdle()

            val totp = model.state.value.totp as Loadable.Failed
            val passkeys = model.state.value.passkeys as Loadable.Failed
            assertTrue(totp.isRetryable, "Ağ hatası tekrar denenebilir olmalı.")
            assertTrue(passkeys.message.isNotBlank())
        }

    @Test
    @DisplayName("Passkey silinince listeden düşüyor")
    fun deleteRemovesTheKey() =
        runTest {
            val model = viewModel()
            model.load()
            advanceUntilIdle()

            val first = (model.state.value.passkeys as Loadable.Loaded).value.first()
            model.deletePasskey(first.id)
            advanceUntilIdle()

            val remaining = (model.state.value.passkeys as Loadable.Loaded).value
            assertEquals(1, remaining.size)
            assertNull(model.state.value.deleteError)
            assertNull(model.state.value.deletingPasskeyId)
        }

    @Test
    @DisplayName("Son passkey silinemez: 409 bir çökme değil, anlaşılır bir ret — liste DEĞİŞMEZ")
    fun lastPasskeyDeletionIsRefusedWithoutLosingTheList() =
        runTest {
            val model = viewModel()
            model.load()
            advanceUntilIdle()

            val keys = (model.state.value.passkeys as Loadable.Loaded).value
            model.deletePasskey(keys[0].id)
            advanceUntilIdle()

            val last = (model.state.value.passkeys as Loadable.Loaded).value.single()
            model.deletePasskey(last.id)
            advanceUntilIdle()

            assertNotNull(model.state.value.deleteError)
            assertEquals(
                1,
                (model.state.value.passkeys as Loadable.Loaded).value.size,
                "İyimser silme yok: reddedilen bir silme listeden satır düşürmemeli.",
            )
            assertNull(model.state.value.deletingPasskeyId)
        }

    @Test
    @DisplayName("Silme hatası sunucunun kendi açıklamasını taşır")
    fun deleteErrorCarriesServerDetail() =
        runTest {
            val model = viewModel()
            model.load()
            advanceUntilIdle()

            val keys = (model.state.value.passkeys as Loadable.Loaded).value
            model.deletePasskey(keys[0].id)
            advanceUntilIdle()
            model.deletePasskey((model.state.value.passkeys as Loadable.Loaded).value.single().id)
            advanceUntilIdle()

            assertTrue(
                model.state.value.deleteError!!.contains("parola", ignoreCase = true),
                "CREDENTIAL_REQUIRED tabloda yok; sunucunun `detail` metnine düşülmeli. " +
                    "Kod: ${ApiErrorCode.CREDENTIAL_REQUIRED}",
            )

            model.dismissDeleteError()
            assertNull(model.state.value.deleteError)
        }
}
