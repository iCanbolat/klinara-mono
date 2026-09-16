package com.klinara.android.features.integrations

import com.klinara.android.features.shell.ManagementDestination
import com.klinara.android.features.shell.ShellSessions
import com.klinara.android.features.shell.managementSections
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.integrations.MockWhatsAppService
import com.klinara.android.services.integrations.WhatsAppAccount
import com.klinara.android.services.integrations.WhatsAppAccountStatus
import com.klinara.android.services.integrations.WhatsAppTemplate
import com.klinara.android.services.integrations.WhatsAppTemplateStatus
import com.klinara.android.services.integrations.WhatsAppTestSend
import com.klinara.android.services.integrations.WhatsAppVerifyResult
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.MessageFilter
import com.klinara.android.services.notifications.MockMessagesService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.builtins.ListSerializer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

/** iOS `Phase8DecodingTests` / `Phase8StoreTests` — WhatsApp dilimi. */
@OptIn(ExperimentalCoroutinesApi::class)
class WhatsAppFeatureTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    private val now = Instant.parse("2026-09-11T09:00:00Z")

    private fun service(
        configured: Boolean = true,
        messages: MockMessagesService? = null,
    ) = MockWhatsAppService(latencyEnabled = false, now = { now }, messages = messages, configured = configured)

    // --- Çözümleme ---

    @Test
    @DisplayName("Hesap yanıtında ham token YOK, yalnız maskesi; durum küçük harf")
    fun decodesAccount() {
        val account =
            KlinaraJson.decodeFromString(
                WhatsAppAccount.serializer(),
                Fixtures.read("integrations/whatsapp-account-active.json"),
            )

        assertEquals(WhatsAppAccountStatus.Active, account.status)
        assertTrue(account.accessTokenMasked.startsWith("••••"))
        assertFalse(Fixtures.read("integrations/whatsapp-account-active.json").contains("\"accessToken\""))
    }

    @Test
    @DisplayName("Meta şablonunun durumu küçük harf gelir; değişkenli şablon test edilemez")
    fun decodesTemplates() {
        val template =
            KlinaraJson
                .decodeFromString(
                    ListSerializer(WhatsAppTemplate.serializer()),
                    Fixtures.read("integrations/whatsapp-templates.json"),
                ).single()

        assertEquals(WhatsAppTemplateStatus.Approved, template.status)
        assertEquals(2, template.bodyVariableCount)
        assertFalse(template.isTestable)
        assertEquals(listOf("Onayla", "İptal Et"), template.buttons.map { it.text })
    }

    @Test
    @DisplayName("Doğrulama başarısızken de bir SONUÇ, hata değil")
    fun verifyFailureIsAResult() {
        val failed =
            KlinaraJson.decodeFromString(
                WhatsAppVerifyResult.serializer(),
                """{"ok": false, "error": "Invalid OAuth access token", "templateCount": 0}""",
            )

        assertFalse(failed.ok)
        assertNotNull(failed.error)
    }

    // --- Taslak ---

    @Test
    @DisplayName("Token her kayıtta zorunlu; secret boşsa gönderilmez (sunucu korur), sürüm biçimi denetlenir")
    fun draftRules() {
        val existing = runTestAccount()
        val draft = WhatsAppAccountDraft.from(existing)

        assertFalse(draft.isDirty)
        assertFalse(draft.copy(businessPhone = "+905321112233").isValid, "Token girilmeden kaydedilemez")

        val withToken = draft.copy(accessToken = "EAAG-yeni-token-1234")
        assertTrue(withToken.isValid)
        assertNull(withToken.input().appSecret, "Boş secret YAZILMAZ — [S] A8.3 ile kayıtlısı korunur")
        assertFalse(withToken.copy(appSecret = "kisa").isValid)
        assertFalse(withToken.copy(apiVersion = "21").isValid)
        assertEquals("'v21.0' biçiminde olmalı.", withToken.copy(apiVersion = "21").apiVersionError)
    }

    private fun runTestAccount(): WhatsAppAccount =
        KlinaraJson.decodeFromString(
            WhatsAppAccount.serializer(),
            Fixtures.read("integrations/whatsapp-account-active.json"),
        )

    // --- ViewModel ---

    @Test
    @DisplayName("Kurulmamış hesap `Loaded(null)` — hata değil; şablon istenmez")
    fun unconfiguredIsEmptyState() =
        runTest(dispatcher) {
            val viewModel = WhatsAppViewModel(service(configured = false))
            viewModel.load()
            advanceUntilIdle()

            assertEquals(Loadable.Loaded(null), viewModel.state.value.account)
            assertTrue(viewModel.state.value.templates is Loadable.Loading)
        }

    @Test
    @DisplayName("Kayıt doğrulamayı düşürür ve eski sonucu siler; doğrula hesabı `active` yapar")
    fun saveThenVerify() =
        runTest(dispatcher) {
            val whatsapp = service()
            val viewModel = WhatsAppViewModel(whatsapp)
            viewModel.load()
            advanceUntilIdle()
            viewModel.verify()
            advanceUntilIdle()
            assertEquals(true, viewModel.state.value.lastVerify?.ok)

            val saved =
                whatsapp.upsertAccount(
                    WhatsAppAccountDraft.from(viewModel.state.value.account.valueOrNull)
                        .copy(accessToken = "EAAG-yeni-token-1234")
                        .input(),
                )
            viewModel.accountSaved(saved)
            assertNull(viewModel.state.value.lastVerify)
            assertEquals(WhatsAppAccountStatus.Unconfigured, viewModel.state.value.account.valueOrNull?.status)
            assertTrue(saved.hasAppSecret, "Secret verilmedi, kayıtlısı korundu")
            assertTrue(saved.accessTokenMasked.endsWith("1234"))

            viewModel.verify()
            advanceUntilIdle()
            assertEquals(WhatsAppAccountStatus.Active, viewModel.state.value.account.valueOrNull?.status)
        }

    @Test
    @DisplayName("Test şablonu AD + DİL ile seçilir; yalnız değişkensiz onaylılar listelenir")
    fun testSelectionUsesLanguage() =
        runTest(dispatcher) {
            val messages = MockMessagesService(latencyEnabled = false, now = { now })
            val whatsapp = service(messages = messages)
            val shared = WhatsAppViewModel(whatsapp)
            shared.load()
            advanceUntilIdle()
            val testable = shared.state.value.testableTemplates
            assertEquals(listOf("baglanti_testi|tr", "baglanti_testi|en"), testable.map { it.rowId })

            val viewModel = WhatsAppTestViewModel(whatsapp)
            viewModel.setPhone("+905321112233")
            viewModel.select(testable.last())
            viewModel.send(testable)
            advanceUntilIdle()

            assertEquals(true, viewModel.state.value.result?.accepted)
            val logged = messages.messages(limit = 50, filter = MessageFilter.NONE).data.first()
            assertEquals("Test: baglanti_testi", logged.body)
            assertTrue("*" in logged.to, "Günlükte numara maskeli")
        }

    @Test
    @DisplayName("Geçersiz numara alan hatası (sunucu gibi VALIDATION_FAILED); kota hatası tekrar denenebilir")
    fun testSendErrors() =
        runTest(dispatcher) {
            val whatsapp = service()
            val testable = whatsapp.templates().filter { it.isTestable }
            val viewModel = WhatsAppTestViewModel(whatsapp)
            viewModel.select(testable.first())

            viewModel.setPhone("+90123")
            viewModel.send(testable)
            advanceUntilIdle()
            assertNotNull(viewModel.state.value.fieldErrors["to"])
            assertNull(viewModel.state.value.error, "Alan hatası üstte ikinci kez yazılmaz")

            viewModel.setPhone("+905321112233")
            repeat(3) {
                viewModel.send(testable)
                advanceUntilIdle()
            }
            assertTrue(viewModel.state.value.isRetryable)
            assertTrue(viewModel.state.value.error!!.contains("kota"))
        }

    @Test
    @DisplayName("Onaysız şablonla gönderim KALICI hata — WHATSAPP_TEMPLATE_NOT_APPROVED")
    fun pendingTemplateIsPermanent() =
        runTest(dispatcher) {
            val whatsapp = service()
            val pending = whatsapp.templates().first { it.status == WhatsAppTemplateStatus.Pending }
            val error =
                runCatching {
                    whatsapp.sendTest(WhatsAppTestSend("+905321112233", pending.name, pending.language))
                }.exceptionOrNull() as ApiError

            assertEquals(ApiErrorCode.WHATSAPP_TEMPLATE_NOT_APPROVED, error.code)
            assertFalse(error.isRetryable)
        }

    @Test
    @DisplayName("WhatsApp satırı yalnız `notification:manage` ile: resepsiyon ve uygulayıcı görmez")
    fun hubMatrix() {
        fun seesWhatsApp(role: String) =
            managementSections(ShellSessions.forRole(role))
                .flatMap { it.rows }
                .any { it.destination == ManagementDestination.WhatsApp }

        assertTrue(seesWhatsApp("owner"))
        assertTrue(seesWhatsApp("manager"))
        assertFalse(seesWhatsApp("receptionist"))
        assertFalse(seesWhatsApp("practitioner"))
    }
}
