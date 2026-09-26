package com.klinara.android.services.notifications

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.integrations.InboxItem
import com.klinara.android.services.integrations.WhatsAppAccount
import com.klinara.android.services.integrations.WhatsAppAccountStatus
import com.klinara.android.services.integrations.WhatsAppTemplate
import com.klinara.android.services.integrations.WhatsAppTemplateButton
import com.klinara.android.services.integrations.WhatsAppTemplateStatus
import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.mock.MockIds
import java.time.Duration
import java.time.Instant

/**
 * Mock bildirim verisinin başlangıç durumu — iOS `MockNotificationsSeed` paritesi.
 *
 * Tohum kasıtlı olarak **kurulumu yarım kalmış bir klinik**: bir hatırlatma okunmuş, bir gelmedi
 * takibi pasif şablon yüzünden `skipped` yazılmış, biri geçersiz numaraya takılmış, gelen kutusunda
 * işlenmemiş iki mesaj var (biri tanınmayan numaradan). Her şeyin yolunda olduğu bir tohum,
 * ekranların asıl zor durumlarını hiç göstermezdi.
 *
 * Müşteri kimlikleri [MockCustomers]'tan: gelen kutusundaki "Müşteri kartı" bağlantısı mock
 * grafiğinde gerçekten bir karta açılmalı.
 */
internal object MockNotificationsSeed {
    const val MESSAGE_REMINDER_READ = "e1000000-0000-4000-8000-000000000001"
    const val MESSAGE_CONFIRMATION_DELIVERED = "e1000000-0000-4000-8000-000000000002"
    const val MESSAGE_NO_SHOW_SKIPPED = "e1000000-0000-4000-8000-000000000003"
    const val MESSAGE_REMINDER_FAILED = "e1000000-0000-4000-8000-000000000004"
    const val MESSAGE_STAFF_INTERNAL = "e1000000-0000-4000-8000-000000000005"

    const val INBOX_AYSE = "e2000000-0000-4000-8000-000000000001"
    const val INBOX_UNKNOWN = "e2000000-0000-4000-8000-000000000002"
    const val INBOX_HANDLED = "e2000000-0000-4000-8000-000000000003"


    val AYSE: String get() = MockCustomers.at(0).id
    val ZEYNEP: String get() = MockCustomers.at(1).id
    val FATMA: String get() = MockCustomers.at(FATMA_INDEX).id
    val MEHMET: String get() = MockCustomers.at(MEHMET_INDEX).id

    private const val FATMA_INDEX = 3
    private const val MEHMET_INDEX = 4

    /** Adlandırılmış argüman: tohum tablosu okunur kalsın, her sayı bir sabit olmasın. */
    private fun Instant.ago(
        days: Long = 0,
        hours: Long = 0,
        minutes: Long = 0,
        seconds: Long = 0,
    ): Instant = minus(Duration.ofDays(days).plusHours(hours).plusMinutes(minutes).plusSeconds(seconds))

    fun messages(now: Instant): List<Message> =
        listOf(
            Message(
                id = MESSAGE_REMINDER_READ,
                customerId = AYSE,
                channel = NotificationChannel.WhatsApp,
                event = NotificationEvent.AppointmentReminder,
                status = MessageStatus.Read,
                to = "+90**********33",
                body = "Sayın Ayşe Yılmaz, yarın 10:00 randevunuzu hatırlatırız.",
                attempt = 1,
                scheduledFor = now.ago(hours = 20),
                sentAt = now.ago(hours = 20),
                deliveredAt = now.ago(hours = 20, seconds = -12),
                createdAt = now.ago(hours = 26),
            ),
            Message(
                id = MESSAGE_CONFIRMATION_DELIVERED,
                customerId = ZEYNEP,
                channel = NotificationChannel.WhatsApp,
                event = NotificationEvent.AppointmentConfirmation,
                status = MessageStatus.Delivered,
                to = "+90**********34",
                body = "Sayın Zeynep Kaya, randevunuz oluşturuldu.",
                attempt = 1,
                scheduledFor = now.ago(hours = 8),
                sentAt = now.ago(hours = 8),
                deliveredAt = now.ago(hours = 8, seconds = -9),
                createdAt = now.ago(hours = 8),
            ),
            // Ek M: gönderilmeyen mesaj ATILMIYOR, `skipped` yazılıyor. "Gitmedi mi, hiç denendi
            // mi?" sorusu cevaplanabilir kalmalı.
            Message(
                id = MESSAGE_NO_SHOW_SKIPPED,
                customerId = MEHMET,
                channel = NotificationChannel.WhatsApp,
                event = NotificationEvent.NoShowFollowup,
                status = MessageStatus.Skipped,
                to = "+90**********37",
                body = "Sayın Mehmet Aslan, randevunuza katılamadınız.",
                attempt = 0,
                scheduledFor = now.ago(days = 3),
                createdAt = now.ago(days = 3),
            ),
            Message(
                id = MESSAGE_REMINDER_FAILED,
                customerId = FATMA,
                channel = NotificationChannel.WhatsApp,
                event = NotificationEvent.AppointmentReminder,
                status = MessageStatus.Failed,
                to = "+90**********36",
                body = "Sayın Fatma Şahin, bugün 15:30 randevunuzu hatırlatırız.",
                errorCode = ApiErrorCode.WHATSAPP_INVALID_RECIPIENT.wire,
                attempt = 1,
                scheduledFor = now.ago(hours = 2),
                createdAt = now.ago(hours = 5),
            ),
            // Alıcısı müşteri değil personel: `customerId` boş, `userId` dolu.
            Message(
                id = MESSAGE_STAFF_INTERNAL,
                userId = MockIds.USER_MANAGER,
                channel = NotificationChannel.Email,
                event = NotificationEvent.StaffInternal,
                status = MessageStatus.Sent,
                to = "a****@klinara.app",
                subject = "Gönderilemeyen hatırlatma",
                body = "Fatma Şahin'in randevu hatırlatması gönderilemedi.",
                attempt = 1,
                scheduledFor = now.ago(hours = 2, seconds = -30),
                sentAt = now.ago(hours = 2, seconds = -32),
                createdAt = now.ago(hours = 2, seconds = -30),
            ),
        )

    fun inbox(now: Instant): List<InboxItem> =
        listOf(
            InboxItem(
                id = INBOX_AYSE,
                customerId = AYSE,
                from = "+90**********33",
                messageType = "text",
                body = "Merhaba, yarınki randevumu bir saat öne alabilir miyiz?",
                receivedAt = now.ago(minutes = 45),
            ),
            // Tanınmayan numara: sunucu bilerek eşleştirmiyor — yanlış müşteriye bağlamak
            // yanlış kartı açardı.
            InboxItem(
                id = INBOX_UNKNOWN,
                from = "+90**********88",
                messageType = "text",
                body = "Fiyat listeniz var mı?",
                receivedAt = now.ago(hours = 3),
            ),
            InboxItem(
                id = INBOX_HANDLED,
                customerId = ZEYNEP,
                from = "+90**********34",
                messageType = "image",
                receivedAt = now.ago(days = 2),
                handledAt = now.ago(days = 2, minutes = -30),
            ),
        )

    const val TEMPLATE_REMINDER_WHATSAPP = "e4000000-0000-4000-8000-000000000001"

    /**
     * Kiracının kendi metnini yazdığı TEK şablon — ve kod varsayılanı OLMAYAN bir kanalda
     * (WhatsApp): sunucu onu listenin sonuna ekliyor, mock da öyle.
     */
    fun tenantTemplates(): List<NotificationTemplate> =
        listOf(
            NotificationTemplate(
                templateId = TEMPLATE_REMINDER_WHATSAPP,
                event = NotificationEvent.AppointmentReminder,
                channel = NotificationChannel.WhatsApp,
                body = "Sayın {{customerName}}, {{appointmentAt}} tarihli {{serviceName}} randevunuzu hatırlatırız.",
                whatsappTemplateName = "randevu_hatirlatma",
                whatsappTemplateLanguage = "tr",
                whatsappVariables = listOf("customerName", "appointmentAt", "serviceName"),
                variables = listOf("customerName", "appointmentAt", "serviceName"),
            ),
        )

    /**
     * Kod varsayılanları — sunucunun birleştirilmiş görünümüyle **birebir aynı kanallar**: müşteri
     * olaylarında yalnız WhatsApp satırı (metni standart Meta template'inden), personel iç
     * bildiriminde e-posta. Standart template'i olmayan paket süre dolumu listede yok.
     */
    fun defaultTemplates(): List<NotificationTemplate> =
        DEFAULT_BODIES.map { (event, channel, body) ->
            NotificationTemplate(
                event = event,
                channel = channel,
                subject = event.turkishName.takeIf { channel == NotificationChannel.Email },
                body = body,
                isDefault = true,
                variables = NotificationEventCatalog.placeholders(body),
            )
        }

    private val DEFAULT_BODIES: List<Triple<NotificationEvent, NotificationChannel, String>> =
        listOf(
            whatsapp(
                NotificationEvent.AppointmentConfirmation,
                "Merhaba {{customerName}}, {{appointmentAt}} tarihindeki {{serviceName}} randevunuz oluşturuldu. " +
                    "Sizi {{branchName}} şubemizde bekliyoruz.",
            ),
            whatsapp(
                NotificationEvent.AppointmentReminder,
                "Merhaba {{customerName}}, {{appointmentAt}} tarihindeki {{serviceName}} randevunuzu hatırlatırız. " +
                    "Adres: {{branchName}} şubemiz. Katılımınızı aşağıdaki butonlarla bildirebilirsiniz.",
            ),
            whatsapp(
                NotificationEvent.AppointmentCancelled,
                "Merhaba {{customerName}}, {{appointmentAt}} tarihindeki randevunuz iptal edilmiştir. " +
                    "Yeni bir randevu için {{branchName}} şubemize bu mesajı yanıtlayarak ulaşabilirsiniz.",
            ),
            whatsapp(
                NotificationEvent.NoShowFollowup,
                "Merhaba {{customerName}}, bugünkü randevunuza gelemediğinizi gördük. " +
                    "Yeni bir randevu için {{branchName}} şubemize bu mesajı yanıtlayarak ulaşabilirsiniz.",
            ),
            whatsapp(
                NotificationEvent.PackageBalance,
                "Merhaba {{customerName}}, {{packageName}} paketinizde {{remainingSessions}} seans hakkınız kaldı. " +
                    "Randevu için bu mesajı yanıtlayabilirsiniz.",
            ),
            whatsapp(NotificationEvent.AutoReply, "{{message}}"),
            Triple(NotificationEvent.StaffInternal, NotificationChannel.Email, "{{message}}"),
        )

    private fun whatsapp(
        event: NotificationEvent,
        body: String,
    ) = Triple(event, NotificationChannel.WhatsApp, body)

    /**
     * Kiracı paket süre dolumu mesajını kapatmış (`channels: []`) ve randevu hatırlatmasında
     * sessiz saati daraltmış. Kalan olaylar sunucunun sentezlediği varsayılanla gelir.
     */
    fun tenantPreferences(): List<NotificationPreference> =
        listOf(
            NotificationPreference(
                preferenceId = "e5000000-0000-4000-8000-000000000001",
                event = NotificationEvent.AppointmentReminder,
                channels = listOf(NotificationChannel.WhatsApp),
                quietHoursStart = "22:00",
                quietHoursEnd = "08:00",
            ),
            NotificationPreference(
                preferenceId = "e5000000-0000-4000-8000-000000000002",
                event = NotificationEvent.PackageExpiring,
                channels = emptyList(),
            ),
        )

    fun account(now: Instant): WhatsAppAccount =
        WhatsAppAccount(
            wabaId = "1029384756",
            phoneNumberId = "5647382910",
            businessPhone = "+902121234567",
            apiVersion = "v26.0",
            status = WhatsAppAccountStatus.Active,
            accessTokenMasked = "••••••••aF3k",
            hasAppSecret = true,
            lastVerifiedAt = now.ago(hours = 6),
        )

    /** Biri değişkenli, biri test edilebilir (değişkensiz + onaylı), biri onay bekliyor. */
    fun whatsAppTemplates(now: Instant): List<WhatsAppTemplate> =
        listOf(
            WhatsAppTemplate(
                name = "randevu_hatirlatma",
                language = "tr",
                category = "UTILITY",
                status = WhatsAppTemplateStatus.Approved,
                bodyVariableCount = 3,
                buttons =
                    listOf(
                        WhatsAppTemplateButton("QUICK_REPLY", "Onayla"),
                        WhatsAppTemplateButton("QUICK_REPLY", "İptal Et"),
                    ),
                syncedAt = now.ago(hours = 6),
            ),
            WhatsAppTemplate(
                name = "baglanti_testi",
                language = "tr",
                category = "UTILITY",
                status = WhatsAppTemplateStatus.Approved,
                syncedAt = now.ago(hours = 6),
            ),
            // Aynı ad başka dilde: test ekranı seçimi ad + dil ile yapmalı (iOS yalnız ada bakıyordu).
            WhatsAppTemplate(
                name = "baglanti_testi",
                language = "en",
                category = "UTILITY",
                status = WhatsAppTemplateStatus.Approved,
                syncedAt = now.ago(hours = 6),
            ),
            WhatsAppTemplate(
                name = "klinara_paket_bakiye",
                language = "tr",
                category = "UTILITY",
                status = WhatsAppTemplateStatus.Pending,
                bodyVariableCount = 3,
                syncedAt = now.ago(hours = 6),
            ),
        )
}
