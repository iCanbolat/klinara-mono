package com.klinara.android.services.integrations

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.notifications.Message
import com.klinara.android.services.notifications.MessageStatus
import com.klinara.android.services.notifications.MockMessagesService
import com.klinara.android.services.notifications.MockNotificationsSeed
import com.klinara.android.services.notifications.NotificationChannel
import com.klinara.android.services.notifications.NotificationEvent
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.random.Random

/**
 * WhatsApp ve gelen kutusu mock'u — iOS `MockWhatsAppService` paritesi.
 *
 * Gelen kutusunda tanınmayan numaradan bir mesaj ve işlenmiş bir görsel; hesap bağlı ama bir
 * şablon Meta'da hâlâ onay bekliyor. Taklit edilen sunucu davranışları:
 * - **Ham token asla dönmez** — kaydedilen token maskeleniyor, saklanmıyor.
 * - **Kaydetmek doğrulamayı düşürür** (`unconfigured`); secret verilmezse KORUNUR ([S] A8.3).
 * - **Kalıcı / geçici ayrımı**: onaysız ya da değişkenli şablon 422, kota 503. Geçersiz numara
 *   sunucudaki gibi `VALIDATION_FAILED` (iOS mock'u `WHATSAPP_INVALID_RECIPIENT` diyordu).
 * - Test gönderimi [messages] üzerinden mesaj günlüğüne düşer (sunucuda aynı tablo).
 */
class MockWhatsAppService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
    private val now: () -> Instant = Instant::now,
    private val messages: MockMessagesService? = null,
    configured: Boolean = true,
) : WhatsAppService {
    var failing: Boolean = false

    private val inboxRecords: MutableList<InboxItem> = MockNotificationsSeed.inbox(now()).toMutableList()
    private var accountRecord: WhatsAppAccount? = if (configured) MockNotificationsSeed.account(now()) else null
    private var templateRecords: List<WhatsAppTemplate> = MockNotificationsSeed.whatsAppTemplates(now())
    private val testSendCount: MutableMap<String, Int> = mutableMapOf()
    private var sendCounter: Int = 0

    override suspend fun account(): WhatsAppAccount? {
        settle()
        return accountRecord
    }

    override suspend fun upsertAccount(input: WhatsAppAccountUpsert): WhatsAppAccount {
        settle()
        val saved =
            WhatsAppAccount(
                wabaId = input.wabaId,
                phoneNumberId = input.phoneNumberId,
                businessPhone = input.businessPhone,
                apiVersion = input.apiVersion ?: WhatsAppAccountUpsert.DEFAULT_API_VERSION,
                // Yeni kimlik bilgileri Meta'ya karşı henüz sınanmadı.
                status = WhatsAppAccountStatus.Unconfigured,
                accessTokenMasked = MASK + input.accessToken.takeLast(MASK_TAIL),
                hasAppSecret = input.appSecret != null || accountRecord?.hasAppSecret == true,
            )
        accountRecord = saved
        return saved
    }

    /** Başarısızlık bir SONUÇ: uç 200 ile `ok: false` döndürüyor, fırlatmıyor. */
    override suspend fun verify(): WhatsAppVerifyResult {
        settle()
        val account =
            accountRecord ?: return WhatsAppVerifyResult(ok = false, error = "WhatsApp hesabı yapılandırılmamış")
        accountRecord = account.copy(status = WhatsAppAccountStatus.Active, lastVerifiedAt = now(), lastError = null)
        return WhatsAppVerifyResult(ok = true, templateCount = templateRecords.size)
    }

    override suspend fun templates(): List<WhatsAppTemplate> {
        settle()
        return templateRecords
    }

    override suspend fun sendTest(input: WhatsAppTestSend): WhatsAppTestResult {
        settle()
        if (accountRecord == null) {
            throw permanent(ApiErrorCode.WHATSAPP_NOT_CONFIGURED, "WhatsApp hesabı yapılandırılmamış")
        }
        val template =
            templateRecords.firstOrNull { it.name == input.templateName && it.language == input.templateLanguage }
                ?: throw permanent(ApiErrorCode.WHATSAPP_TEMPLATE_NOT_APPROVED, "Şablon bulunamadı")
        if (template.status != WhatsAppTemplateStatus.Approved) {
            throw permanent(ApiErrorCode.WHATSAPP_TEMPLATE_NOT_APPROVED, "Şablon Meta'da onaylı değil")
        }
        if (template.bodyVariableCount > 0) {
            throw permanent(
                ApiErrorCode.WHATSAPP_TEMPLATE_NOT_APPROVED,
                "Bu şablon ${template.bodyVariableCount} değişken bekliyor; test gönderimi parametresiz yapılır",
            )
        }
        val digits = input.to.filter(Char::isDigit)
        if (digits.length !in PHONE_DIGITS) {
            // Sunucu Meta'ya gitmeden VALIDATION_FAILED veriyor (`whatsapp.service.ts`).
            throw MockErrors.validation("to", "Telefon numarası geçersiz")
        }
        // Kota simülasyonu: aynı numaraya üçüncü gönderim geçici hataya düşer.
        val count = (testSendCount[digits] ?: 0) + 1
        testSendCount[digits] = count
        if (count >= RATE_LIMIT_AT) {
            throw MockErrors.problem(
                ApiErrorCode.WHATSAPP_RATE_LIMITED,
                "Kota doldu",
                MockErrors.HTTP_SERVICE_UNAVAILABLE,
                "Sağlayıcı gönderim kotası aşıldı",
            )
        }
        sendCounter += 1
        messages?.record(
            Message(
                id = "e6000000-0000-4000-8000-%012d".format(sendCounter),
                userId = MockIds.USER_MANAGER,
                channel = NotificationChannel.WhatsApp,
                event = NotificationEvent.AutoReply,
                status = MessageStatus.Sent,
                to = "+${digits.take(2)}${"*".repeat(digits.length - MASK_TAIL)}${digits.takeLast(2)}",
                body = "Test: ${template.name}",
                attempt = 1,
                scheduledFor = now(),
                sentAt = now(),
                createdAt = now(),
            ),
        )
        return WhatsAppTestResult(accepted = true, providerMessageId = "wamid.mock-$sendCounter")
    }

    private fun permanent(
        code: ApiErrorCode,
        detail: String,
    ) = MockErrors.problem(code, "Gönderilemedi", MockErrors.HTTP_UNPROCESSABLE, detail)

    override suspend fun inbox(
        onlyUnhandled: Boolean,
        limit: Int?,
    ): List<InboxItem> {
        settle()
        val filtered =
            inboxRecords
                .filter { !onlyUnhandled || !it.isHandled }
                .sortedByDescending { it.receivedAt }
        return if (limit == null) filtered else filtered.take(limit)
    }

    override suspend fun markInboxHandled(id: String) {
        settle()
        val index = inboxRecords.indexOfFirst { it.id == id }
        if (index < 0) throw MockErrors.notFound("Mesaj")
        inboxRecords[index] = inboxRecords[index].copy(handledAt = now())
    }

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    private companion object {
        const val MASK = "••••••••"
        const val MASK_TAIL = 4
        val PHONE_DIGITS = 7..15
        const val RATE_LIMIT_AT = 3
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
    }
}
