import Foundation

/// Mock bildirim verisinin başlangıç durumu.
///
/// Tohum kasıtlı olarak **kurulumu yarım kalmış bir klinik**i temsil eder:
/// WhatsApp bağlı ama bir şablon Meta'da hâlâ onay bekliyor, bir hatırlatma
/// gönderilmiş, bir tanesi iletişim izni yüzünden `skipped` yazılmış, gelen
/// kutusunda okunmamış iki mesaj var. Her şeyin yolunda olduğu bir tohum,
/// ekranların asıl zor durumlarını (başarısız gönderim, atlanmış mesaj,
/// tanınmayan numara) hiç göstermezdi.
enum MockNotificationsSeed {

    static let messageReminderSent = "e1000000-0000-4000-8000-000000000001"
    static let messageConfirmationDelivered = "e1000000-0000-4000-8000-000000000002"
    static let messageBirthdaySkipped = "e1000000-0000-4000-8000-000000000003"
    static let messageReminderFailed = "e1000000-0000-4000-8000-000000000004"
    static let messageStaffInternal = "e1000000-0000-4000-8000-000000000005"

    static let inboxAyse = "e2000000-0000-4000-8000-000000000001"
    static let inboxUnknown = "e2000000-0000-4000-8000-000000000002"
    static let inboxHandled = "e2000000-0000-4000-8000-000000000003"

    static let optOutMehmet = "e3000000-0000-4000-8000-000000000001"

    /// Kiracının kendi metnini yazdığı **tek** şablon. Kalanlar kod
    /// varsayılanıyla (`isDefault: true`, `id: nil`) döner — sunucunun
    /// birleştirilmiş etkin görünümünün aynısı.
    static let templateReminderWhatsApp = "e4000000-0000-4000-8000-000000000001"

    // MARK: Şablonlar

    /// Kiracıya ait, kod varsayılanını ezen satırlar.
    static func tenantTemplates() -> [NotificationTemplate] {
        [
            NotificationTemplate(
                templateId: templateReminderWhatsApp,
                event: .appointmentReminder,
                channel: .whatsapp,
                locale: "tr",
                kind: .transactional,
                subject: nil,
                body: "Sayın {{customerName}}, {{appointmentAt}} tarihli {{serviceName}} randevunuzu hatırlatırız.",
                whatsappTemplateName: "randevu_hatirlatma",
                whatsappTemplateLanguage: "tr",
                whatsappVariables: ["customerName", "appointmentAt", "serviceName"],
                isActive: true,
                isDefault: false,
                variables: ["customerName", "appointmentAt", "serviceName"]
            )
        ]
    }

    /// Kod varsayılanları — sunucudaki `default-templates.ts`in istemci aynası.
    /// Yalnız mock için: canlıda bu satırlar sunucudan gelir.
    static func defaultTemplates() -> [NotificationTemplate] {
        NotificationEvent.selectable.flatMap { event -> [NotificationTemplate] in
            guard let definition = NotificationEventCatalog.definitions[event] else { return [] }
            return definition.channels.map { channel in
                NotificationTemplate(
                    templateId: nil,
                    event: event,
                    channel: channel,
                    locale: "tr",
                    kind: definition.kind,
                    subject: channel == .email ? "\(event.turkishName)" : nil,
                    // WhatsApp kanalının kod varsayılanı SMS gövdesine düşüyor
                    // (Ek M, düzeltilen hata #3): gerçek gönderimde zaten Meta'da
                    // onaylı template adı kullanılıyor.
                    body: defaultBody(for: event),
                    whatsappTemplateName: nil,
                    whatsappTemplateLanguage: nil,
                    whatsappVariables: [],
                    isActive: true,
                    isDefault: true,
                    variables: definition.variables
                )
            }
        }
    }

    private static func defaultBody(for event: NotificationEvent) -> String {
        switch event {
        case .appointmentConfirmation:
            return "Sayın {{customerName}}, {{branchName}} şubemizdeki {{appointmentAt}} tarihli {{serviceName}} randevunuz oluşturuldu."
        case .appointmentReminder:
            return "Sayın {{customerName}}, {{appointmentAt}} tarihli {{serviceName}} randevunuzu hatırlatırız."
        case .appointmentCancelled:
            return "Sayın {{customerName}}, {{appointmentAt}} tarihli randevunuz iptal edilmiştir."
        case .noShowFollowup:
            return "Sayın {{customerName}}, randevunuza katılamadınız. {{branchName}} şubemizden yeni bir randevu alabilirsiniz."
        case .packageBalance:
            return "Sayın {{customerName}}, {{packageName}} paketinizde {{remainingSessions}} seans hakkınız kaldı."
        case .packageExpiring:
            return "Sayın {{customerName}}, {{packageName}} paketiniz {{expiresAt}} tarihinde doluyor; {{remainingSessions}} seans hakkınız var."
        case .birthday:
            return "Sayın {{customerName}}, doğum gününüzü {{branchName}} olarak kutlarız."
        case .autoReply:
            return "{{message}}"
        case .staffInternal:
            return "{{subject}} — {{message}}"
        case .unknown:
            return ""
        }
    }

    // MARK: Tercihler

    /// Kiracı, doğum günü mesajını kapatmış (`channels: []`) ve randevu
    /// hatırlatmasında sessiz saati daraltmış. Kalan olaylar varsayılanda.
    static func tenantPreferences() -> [NotificationPreference] {
        [
            NotificationPreference(
                preferenceId: MockIDs.uuid(),
                branchId: nil,
                event: .appointmentReminder,
                kind: .transactional,
                channels: [.whatsapp, .email],
                quietHoursStart: "22:00",
                quietHoursEnd: "08:00",
                isDefault: false
            ),
            NotificationPreference(
                preferenceId: MockIDs.uuid(),
                branchId: nil,
                event: .birthday,
                kind: .marketing,
                channels: [],
                quietHoursStart: nil,
                quietHoursEnd: nil,
                isDefault: false
            ),
        ]
    }

    /// Kiracı satırı olmayan her olay için sentezlenen varsayılan.
    static func defaultPreference(for event: NotificationEvent) -> NotificationPreference {
        let definition = NotificationEventCatalog.definitions[event]
        return NotificationPreference(
            preferenceId: nil,
            branchId: nil,
            event: event,
            kind: definition?.kind ?? .transactional,
            channels: definition?.channels ?? [],
            quietHoursStart: "21:00",
            quietHoursEnd: "09:00",
            isDefault: true
        )
    }

    // MARK: Hatırlatma ayarları

    /// Nişantaşı şubesinin **kendi** override'ı var (24 + 4 saat); Bağdat
    /// caddesi kiracı varsayılanını kullanıyor. İki şubenin farklı olması,
    /// `isBranchOverride` ayrımının ekranda gerçekten sınanmasını sağlıyor.
    static func branchReminderOverrides() -> [String: [Int]] {
        [MockIDs.branchNisantasi: [24, 4]]
    }

    static let tenantReminderHours = [24, 2]

    // MARK: Mesaj günlüğü

    static func messages(at now: Date) -> [Message] {
        [
            message(
                id: messageReminderSent,
                customerId: MockCustomerSeed.ayse,
                channel: .whatsapp,
                event: .appointmentReminder,
                status: .read,
                to: "+90**********01",
                body: "Sayın Ayşe Yılmaz, yarın 10:00 randevunuzu hatırlatırız.",
                attempt: 1,
                scheduledFor: now.addingTimeInterval(-20 * 3_600),
                sentAt: now.addingTimeInterval(-20 * 3_600),
                deliveredAt: now.addingTimeInterval(-20 * 3_600 + 12),
                createdAt: now.addingTimeInterval(-26 * 3_600)
            ),
            message(
                id: messageConfirmationDelivered,
                customerId: MockCustomerSeed.zeynep,
                channel: .whatsapp,
                event: .appointmentConfirmation,
                status: .delivered,
                to: "+90**********03",
                body: "Sayın Zeynep Kaya, randevunuz oluşturuldu.",
                attempt: 1,
                scheduledFor: now.addingTimeInterval(-8 * 3_600),
                sentAt: now.addingTimeInterval(-8 * 3_600),
                deliveredAt: now.addingTimeInterval(-8 * 3_600 + 9),
                createdAt: now.addingTimeInterval(-8 * 3_600)
            ),
            // Ek M: engellenen mesaj ATILMIYOR, `skipped` yazılıyor. "Gitmedi mi,
            // hiç denendi mi?" sorusu cevaplanabilir kalmalı.
            message(
                id: messageBirthdaySkipped,
                customerId: MockCustomerSeed.mehmet,
                channel: .whatsapp,
                event: .birthday,
                status: .skipped,
                to: "+90**********02",
                body: "Sayın Mehmet Demir, doğum gününüzü kutlarız.",
                errorCode: APIErrorCode.optOut.rawValue,
                attempt: 0,
                scheduledFor: now.addingTimeInterval(-3 * 86_400),
                createdAt: now.addingTimeInterval(-3 * 86_400)
            ),
            message(
                id: messageReminderFailed,
                customerId: MockCustomerSeed.burak,
                channel: .whatsapp,
                event: .appointmentReminder,
                status: .failed,
                to: "+90**********04",
                body: "Sayın Burak Şahin, bugün 15:30 randevunuzu hatırlatırız.",
                errorCode: APIErrorCode.whatsappInvalidRecipient.rawValue,
                attempt: 1,
                scheduledFor: now.addingTimeInterval(-2 * 3_600),
                createdAt: now.addingTimeInterval(-5 * 3_600)
            ),
            // Alıcısı müşteri değil personel: `customerId` boş, `userId` dolu.
            message(
                id: messageStaffInternal,
                customerId: nil,
                userId: MockIDs.userOwner,
                channel: .email,
                event: .staffInternal,
                status: .sent,
                to: "o****@klinara.app",
                subject: "Gönderilemeyen hatırlatma",
                body: "Burak Şahin'in randevu hatırlatması gönderilemedi.",
                attempt: 1,
                scheduledFor: now.addingTimeInterval(-2 * 3_600 + 30),
                sentAt: now.addingTimeInterval(-2 * 3_600 + 32),
                createdAt: now.addingTimeInterval(-2 * 3_600 + 30)
            ),
        ]
    }

    private static func message(
        id: String,
        customerId: String?,
        userId: String? = nil,
        channel: NotificationChannel,
        event: NotificationEvent,
        status: MessageStatus,
        to: String,
        subject: String? = nil,
        body: String?,
        errorCode: String? = nil,
        attempt: Int,
        scheduledFor: Date,
        sentAt: Date? = nil,
        deliveredAt: Date? = nil,
        createdAt: Date
    ) -> Message {
        Message(
            id: id,
            customerId: customerId,
            userId: userId,
            channel: channel,
            event: event,
            status: status,
            to: to,
            subject: subject,
            body: body,
            errorCode: errorCode,
            attempt: attempt,
            scheduledFor: scheduledFor,
            sentAt: sentAt,
            deliveredAt: deliveredAt,
            createdAt: createdAt
        )
    }

    // MARK: Gelen kutusu

    static func inbox(at now: Date) -> [InboxItem] {
        [
            InboxItem(
                id: inboxAyse,
                customerId: MockCustomerSeed.ayse,
                from: "+90**********01",
                messageType: "text",
                body: "Merhaba, yarınki randevumu bir saat öne alabilir miyiz?",
                receivedAt: now.addingTimeInterval(-45 * 60),
                handledAt: nil
            ),
            // Tanınmayan numara: `customerId` yok. Sunucu bunu bilerek
            // eşleştirmiyor — yanlış müşteriye bağlamak yanlış kartı açardı.
            InboxItem(
                id: inboxUnknown,
                customerId: nil,
                from: "+90**********88",
                messageType: "text",
                body: "Fiyat listeniz var mı?",
                receivedAt: now.addingTimeInterval(-3 * 3_600),
                handledAt: nil
            ),
            InboxItem(
                id: inboxHandled,
                customerId: MockCustomerSeed.zeynep,
                from: "+90**********03",
                messageType: "image",
                body: nil,
                receivedAt: now.addingTimeInterval(-2 * 86_400),
                handledAt: now.addingTimeInterval(-2 * 86_400 + 1_800)
            ),
        ]
    }

    // MARK: İletişim izni

    static func optOuts(at now: Date) -> [OptOutRecord] {
        [
            // Mehmet tüm kanallarda ticari ileti almıyor — `messageBirthdaySkipped`
            // satırının sebebi bu. İki tohum birbirini AÇIKLAMALI, yoksa mock
            // veri gerçekte olamayacak bir durumu temsil eder.
            OptOutRecord(
                id: optOutMehmet,
                customerId: MockCustomerSeed.mehmet,
                channel: nil,
                kind: .marketing,
                source: .inboundStop,
                createdAt: now.addingTimeInterval(-10 * 86_400)
            )
        ]
    }

    // MARK: WhatsApp hesabı

    static func account(at now: Date) -> WhatsAppAccount {
        WhatsAppAccount(
            wabaId: "1029384756",
            phoneNumberId: "5647382910",
            businessPhone: "+902121234567",
            apiVersion: "v21.0",
            status: .active,
            accessTokenMasked: "••••••••aF3k",
            hasAppSecret: true,
            lastVerifiedAt: now.addingTimeInterval(-6 * 3_600),
            lastError: nil
        )
    }

    static func whatsAppTemplates(at now: Date) -> [WhatsAppTemplate] {
        [
            WhatsAppTemplate(
                name: "randevu_hatirlatma",
                language: "tr",
                category: "UTILITY",
                status: .approved,
                bodyVariableCount: 3,
                buttons: [
                    WhatsAppTemplateButton(type: "QUICK_REPLY", text: "Onayla"),
                    WhatsAppTemplateButton(type: "QUICK_REPLY", text: "İptal Et"),
                ],
                syncedAt: now.addingTimeInterval(-6 * 3_600)
            ),
            // Değişkensiz ve onaylı: test gönderiminin çalıştığı TEK şablon.
            WhatsAppTemplate(
                name: "baglanti_testi",
                language: "tr",
                category: "UTILITY",
                status: .approved,
                bodyVariableCount: 0,
                buttons: [],
                syncedAt: now.addingTimeInterval(-6 * 3_600)
            ),
            WhatsAppTemplate(
                name: "dogum_gunu",
                language: "tr",
                category: "MARKETING",
                status: .pending,
                bodyVariableCount: 2,
                buttons: [],
                syncedAt: now.addingTimeInterval(-6 * 3_600)
            ),
        ]
    }
}
