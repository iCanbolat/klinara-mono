package com.klinara.android.services.mock

import com.klinara.android.services.auth.LoginOutcome
import com.klinara.android.services.auth.LoginStatus
import com.klinara.android.services.auth.MockAuthService
import com.klinara.android.services.auth.outcome
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.contracts.RolePermissions
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * A0.5'in kanıtlaması gereken ŞEY: mock grafiği gerçek JSON üretiyor, üretim
 * çözümleyicisinden geçiyor, ve fixture'lar hem burada (test classpath'i) hem debug
 * APK'de aynı yoldan okunuyor.
 */
class MockAuthServiceTest {
    private fun service(scenario: MockScenario) =
        MockAuthService(scenario, latencyEnabled = false)

    @Test
    @DisplayName("Fixture'lar okunabiliyor — paylaşılan dizin test classpath'inde")
    fun fixturesAreOnTheClasspath() {
        val raw = Fixtures.read("auth/login-authenticated.json")
        assertTrue(raw.contains("mock.access.token"))
    }

    @Test
    @DisplayName("Olmayan fixture sessizce boş dönmez, anlaşılır biçimde patlar")
    fun missingFixtureFailsLoudly() {
        val error = assertThrows(IllegalStateException::class.java) { Fixtures.read("auth/yok.json") }
        assertTrue(error.message!!.contains("klinara-fixtures"))
    }

    @Test
    @DisplayName("Senaryolar giriş yolunu sürüyor")
    fun scenariosDriveLoginBranches() =
        runTest {
            assertEquals(
                LoginStatus.AUTHENTICATED,
                service(MockScenario.PasswordOnly).login(null, "+905321234567", "p", "d").status,
            )
            assertEquals(
                LoginStatus.TENANT_SELECTION_REQUIRED,
                service(MockScenario.MultiTenant).login(null, "+905321234567", "p", "d").status,
            )
            assertEquals(
                LoginStatus.MFA_REQUIRED,
                service(MockScenario.PasswordThenTotp).login(null, "+905321234567", "p", "d").status,
            )
        }

    @Test
    @DisplayName("Zorunlu 2FA kurulmamışken configured=false gelir — kurulum ekranı gerekir")
    fun mandatoryMfaWithoutSetup() =
        runTest {
            val response = service(MockScenario.MfaRequiredNotConfigured).login(null, "+9", "p", "d")
            val outcome = response.outcome()

            assertTrue(outcome is LoginOutcome.NeedsMfa)
            assertFalse((outcome as LoginOutcome.NeedsMfa).challenge.configured)
            assertFalse(outcome.challenge.allowsBackupCode, "Kurulmamışken yedek kod olamaz")
        }

    @Test
    @DisplayName("Hata senaryoları girişi kısa devre yapıyor ve DOĞRU kodu taşıyor")
    fun failureScenariosShortCircuitLogin() =
        runTest {
            val wrong =
                assertThrows(ApiError.Problem::class.java) {
                    kotlinx.coroutines.runBlocking { service(MockScenario.WrongPassword).login(null, "+9", "p", "d") }
                }
            assertEquals(ApiErrorCode.INVALID_CREDENTIALS, wrong.code)
            assertEquals(401, wrong.status)

            val locked =
                assertThrows(ApiError.Problem::class.java) {
                    kotlinx.coroutines.runBlocking { service(MockScenario.AccountLocked).login(null, "+9", "p", "d") }
                }
            assertEquals(ApiErrorCode.ACCOUNT_LOCKED, locked.code)
            assertEquals(423, locked.status)

            assertThrows(ApiError.Network::class.java) {
                kotlinx.coroutines.runBlocking { service(MockScenario.NetworkError).login(null, "+9", "p", "d") }
            }
        }

    @Test
    @DisplayName("İzinler ÜRETİLMİŞ rol demetinden gelir — elle tutulan liste sapamaz")
    fun permissionsComeFromGeneratedBundles() =
        runTest {
            val manager = service(MockScenario.PasswordOnly).me()
            assertEquals(RolePermissions.forRole("manager"), manager.permissions)

            // iOS'ta tam olarak BU eksikti: Faz 6 finans izinleri hiç eklenmemişti ve
            // mock modda kasa/prim/cari ekranlarına ulaşılamıyordu.
            assertTrue(manager.permissions.contains(Permissions.FINANCE_PAYMENT_READ))
            assertTrue(manager.permissions.contains(Permissions.FINANCE_COMMISSION_READ))
            assertTrue(manager.permissions.contains(Permissions.FINANCE_PRICE_OVERRIDE))

            val practitioner = service(MockScenario.PractitionerScope).me()
            assertEquals(RolePermissions.forRole("practitioner"), practitioner.permissions)
            assertFalse(
                practitioner.permissions.contains(Permissions.FINANCE_PAYMENT_WRITE),
                "Uygulayıcı tahsilat yapamaz",
            )
        }

    @Test
    @DisplayName("Çok şubeli senaryo hem branchIds hem üyelikleri genişletiyor")
    fun multiBranchScenarioIsConsistent() =
        runTest {
            val me = service(MockScenario.MultiBranch).me()

            assertEquals(2, me.branchIds.size)
            assertEquals(
                me.branchIds,
                me.user.memberships.mapNotNull { it.branchId },
                "Üyelikler ile branchIds ayrışırsa şube seçimi olmayan bir şubeyi gösterir",
            )
            assertEquals(2, service(MockScenario.MultiBranch).branches().size)
            assertEquals(1, service(MockScenario.PasswordOnly).branches().size)
        }

    @Test
    @DisplayName("Doğrulanmamış telefon akışı: me() false der, verifyPhone sonrası true")
    fun phoneVerificationFlipsState() =
        runTest {
            val auth = service(MockScenario.UnverifiedPhone)
            assertFalse(auth.me().user.phoneVerified)

            auth.verifyPhone("123456")
            assertTrue(auth.me().user.phoneVerified, "Doğrulamadan sonra akış ilerleyebilmeli")
        }

    @Test
    @DisplayName("MFA: yedek kod tire taşır, TOTP altı hane; 000000 her zaman yanlış")
    fun mfaCodeShapes() =
        runTest {
            val auth = service(MockScenario.PasswordThenTotp)

            assertNotNull(auth.verifyMfa("t", "482913", "d"))
            assertNotNull(auth.verifyMfa("t", "4f2a-9c1e", "d"))

            assertThrows(ApiError.Problem::class.java) {
                kotlinx.coroutines.runBlocking { auth.verifyMfa("t", "000000", "d") }
            }
            assertThrows(ApiError.Problem::class.java) {
                kotlinx.coroutines.runBlocking { auth.verifyMfa("t", "12345", "d") }
            }
        }

    @Test
    @DisplayName("Yedek kodlar YALNIZ totpEnable'dan, on adet")
    fun backupCodesComeOnlyFromEnable() =
        runTest {
            val codes = service(MockScenario.PasswordThenTotp).totpEnable("t", "482913")
            assertEquals(10, codes.size)
            assertTrue(codes.all { it.contains('-') }, "Tire yedek kodu TOTP'den ayıran işaret")
        }

    @Test
    @DisplayName("forgotPassword ASLA hata fırlatmaz — hesap sayımı önlenir")
    fun forgotPasswordNeverThrows() =
        runTest {
            // Hata senaryosunda bile.
            service(MockScenario.WrongPassword).forgotPassword("yok@klinik.com")
        }

    @Test
    @DisplayName("TOTP kurulumu gerçek bir otpauth URI'si veriyor")
    fun totpSetupIsUsable() =
        runTest {
            val setup = service(MockScenario.MfaRequiredNotConfigured).totpSetup("t")
            assertTrue(setup.otpauthUri.startsWith("otpauth://totp/"))
            assertTrue(setup.secret.isNotBlank())
        }
}
