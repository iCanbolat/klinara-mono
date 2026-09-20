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
 * Tohum kasıtlı olarak **kurulumu yarım kalmış bir klinik**: bir hatırlatma okunmuş, biri
 * iletişim izni yüzünden `skipped` yazılmış, biri geçersiz numaraya takılmış, gelen kutusunda
 * işlenmemiş iki mesaj var (biri tanınmayan numaradan). Her şeyin yolunda olduğu bir tohum,
 * ekranların asıl zor durumlarını hiç göstermezdi.
 *
 * Müşteri kimlikleri [MockCustomers]'tan: gelen kutusundaki "Müşteri kartı" bağlantısı mock
 * grafiğinde gerçekten bir karta açılmalı.
 */
internal object MockNotificationsSeed {
    const val MESSAGE_REMINDER_READ = "e1000000-0000-4000-8000-000000000001"
    const val MESSAGE_CONFIRMATION_DELIVERED = "e1000000-0000-4000-8000-000000000002"
    const val MESSAGE_BIRTHDAY_SKIPPED = "e1000000-0000-4000-8000-000000000003"
    const val MESSAGE_REMINDER_FAILED = "e1000000-0000-4000-8000-000000000004"
    const val MESSAGE_STAFF_INTERNAL = "e1000000-0000-4000-8000-000000000005"

    const val INBOX_AYSE = "e2000000-0000-4000-8000-000000000001"
    const val INBOX_UNKNOWN = "e2000000-0000-4000-8000-000000000002"
    const val INBOX_HANDLED = "e2000000-0000-4000-8000-000000000003"

    const val OPT_OUT_MEHMET = "e3000000-0000-4000-8000-000000000001"

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
            // Ek M: engellenen mesaj ATILMIYOR, `skipped` yazılıyor. Sebebi [optOuts]'taki kayıt —
            // iki tohum birbirini AÇIKLAMALI, yoksa mock gerçekte olamayacak bir durumu gösterir.
            Message(
                id = MESSAGE_BIRTHDAY_SKIPPED,
                customerId = MEHMET,
                channel = NotificationChannel.WhatsApp,
                event = NotificationEvent.Birthday,
                status = MessageStatus.Skipped,
                to = "+90**********37",
                body = "Sayın Mehmet Aslan, doğum gününüzü kutlarız.",
                errorCode = ApiErrorCode.OPT_OUT.wire,
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
                kind = NotificationKind.Transactional,
                body = "Sayın {{customerName}}, {{appointmentAt}} tarihli {{serviceName}} randevunuzu hatırlatırız.",
                whatsappTemplateName = "randevu_hatirlatma",
                whatsappTemplateLanguage = "tr",
                whatsappVariables = listOf("customerName", "appointmentAt", "serviceName"),
                variables = listOf("customerName", "appointmentAt", "serviceName"),
            ),
        )

    /**
     * Kod varsayılanları — sunucudaki `default-templates.ts`'in `templates` anahtarlarıyla
     * **birebir aynı kanallar** (çoğu olayda SMS + e-posta; WhatsApp yalnız otomatik yanıtta).
     *
     * iOS mock'u varsayılanı olayın TÜM kanallarından üretiyordu ve canlıda hiç görünmeyen
     * WhatsApp satırlarını gösteriyordu; sunucunun gerçek davranışı saklanıyordu.
     */
    fun defaultTemplates(): List<NotificationTemplate> =
        DEFAULT_BODIES.flatMap { (event, byChannel) ->
            byChannel.map { (channel, body) ->
                NotificationTemplate(
                    event = event,
                    channel = channel,
                    kind = NotificationEventCatalog.kind(event),
                    subject = event.turkishName.takeIf { channel == NotificationChannel.Email },
                    body = body,
                    isDefault = true,
                    variables = NotificationEventCatalog.placeholders(body),
                )
            }
        }

    private val DEFAULT_BODIES: List<Pair<NotificationEvent, List<Pair<NotificationChannel, String>>>> =
        listOf(
            NotificationEvent.AppointmentConfirmation to
                smsOnly("Sayın {{customerName}}, {{appointmentAt}} randevunuz oluşturuldu. {{branchName}}"),
            NotificationEvent.AppointmentReminder to
                smsOnly("Sayın {{customerName}}, {{appointmentAt}} randevunuzu hatırlatırız. {{branchName}}"),
            NotificationEvent.AppointmentCancelled to
                smsOnly("Sayın {{customerName}}, {{appointmentAt}} randevunuz iptal edilmiştir. {{branchName}}"),
            NotificationEvent.NoShowFollowup to
                listOf(
                    NotificationChannel.Sms to
                        "Sayın {{customerName}}, randevunuza katılamadınız. " +
                            "{{branchName}} olarak yeni randevu için bekleriz.",
                ),
            NotificationEvent.PackageBalance to
                smsOnly("Sayın {{customerName}}, {{packageName}} paketinizde {{remainingSessions}} seans kaldı."),
            NotificationEvent.PackageExpiring to
                smsOnly("Sayın {{customerName}}, {{packageName}} paketiniz {{expiresAt}} tarihinde doluyor."),
            NotificationEvent.Birthday to
                listOf(NotificationChannel.Sms to "Sayın {{customerName}}, doğum gününüzü kutlarız! {{branchName}}"),
            NotificationEvent.AutoReply to
                listOf(NotificationChannel.WhatsApp to "{{message}}", NotificationChannel.Sms to "{{message}}"),
            NotificationEvent.StaffInternal to listOf(NotificationChannel.Email to "{{message}}"),
        )

    /** Müşteri olaylarının varsayılan gövdesi yalnız SMS'te durur; WhatsApp metni Meta'dan gelir. */
    private fun smsOnly(body: String) = listOf(NotificationChannel.Sms to body)

    /**
     * Kiracı doğum günü mesajını kapatmış (`channels: []`) ve randevu hatırlatmasında sessiz
     * saati daraltmış. Kalan olaylar sunucunun sentezlediği varsayılanla gelir.
     */
    fun tenantPreferences(): List<NotificationPreference> =
        listOf(
            NotificationPreference(
                preferenceId = "e5000000-0000-4000-8000-000000000001",
                event = NotificationEvent.AppointmentReminder,
                kind = NotificationKind.Transactional,
                channels = listOf(NotificationChannel.WhatsApp, NotificationChannel.Sms),
                quietHoursStart = "22:00",
                quietHoursEnd = "08:00",
            ),
            NotificationPreference(
                preferenceId = "e5000000-0000-4000-8000-000000000002",
                event = NotificationEvent.Birthday,
                kind = NotificationKind.Marketing,
                channels = emptyList(),
            ),
        )

    fun account(now: Instant): WhatsAppAccount =
        WhatsAppAccount(
            wabaId = "1029384756",
            phoneNumberId = "5647382910",
            businessPhone = "+902121234567",
            apiVersion = "v21.0",
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
                name = "dogum_gunu",
                language = "tr",
                category = "MARKETING",
                status = WhatsAppTemplateStatus.Pending,
                bodyVariableCount = 2,
                syncedAt = now.ago(hours = 6),
            ),
        )

    /**
     * Mehmet tüm kanallarda ticari ileti almıyor — [MESSAGE_BIRTHDAY_SKIPPED] satırının sebebi.
     *
     * A4.2'deki mock tohumu "bilerek boş değil" diyordu ama boştu; kapalı hâl ancak burada
     * sürülebilir hâle geldi.
     */
    fun optOuts(now: Instant): List<OptOutRecord> =
        listOf(
            OptOutRecord(
                id = OPT_OUT_MEHMET,
                customerId = MEHMET,
                channel = null,
                kind = "marketing",
                source = OptOutSource.InboundStop,
                createdAt = now.ago(days = 10),
            ),
        )
}
