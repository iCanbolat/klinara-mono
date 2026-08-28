import Foundation
import Testing
@testable import klinara_ios

/// Faz 8 sözleşmesinin çözümleme testleri.
///
/// Hepsi ``Fixtures`` içindeki **gerçek sunucu gövdeleriyle** çalışır (tek
/// istisna, bilerek bozulmuş `unknown` örnekleri — sebebi yanlarında yazılı).
/// Bu fazın en kolay kaçırılan üç yeri sınanıyor: `id`'si `null` olabilen
/// satırlar, uca göre değişen liste zarfı ve gövdesiz `200`.
@Suite("Faz 8 çözümleme")
struct Phase8DecodingTests {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try APIClient.decoder.decode(T.self, from: Data(json.utf8))
    }

    // MARK: Şablonlar

    @Test("Kiracı şablonu çözülür; WhatsApp konumsal değişkenlerinin SIRASI korunur")
    func decodesTenantTemplate() throws {
        let template = try decode(NotificationTemplate.self, Fixtures.notificationTemplateWhatsApp)

        #expect(template.templateId != nil)
        #expect(!template.isDefault)
        #expect(template.event == .appointmentReminder)
        #expect(template.channel == .whatsapp)
        #expect(template.kind == .transactional)
        // Sıra Meta'nın `{{1}}, {{2}}` konumlarına karşılık geliyor; bir küme
        // olarak çözmek mesajın parametrelerini karıştırırdı.
        #expect(template.whatsappVariables == ["customerName", "appointmentAt"])
        #expect(template.whatsappTemplateName == "randevu_hatirlatma")
    }

    @Test("Varsayılan şablonun `id`'si null; kimlik bileşik anahtardan gelir")
    func decodesDefaultTemplate() throws {
        let template = try decode(NotificationTemplate.self, Fixtures.notificationTemplateDefault)

        #expect(template.templateId == nil)
        #expect(template.isDefault)
        // `Identifiable` kimliği `id`'den gelseydi listedeki tüm varsayılan
        // satırlar `nil` kimliğini paylaşır ve `ForEach` onları aynı görürdü.
        #expect(template.id == "appointment_confirmation|sms|tr")
        #expect(template.rowId == template.id)
    }

    @Test("E-posta şablonunda konu dolu ve gövdedeki satır sonları korunur")
    func decodesEmailTemplate() throws {
        let template = try decode(
            NotificationTemplate.self,
            Fixtures.notificationTemplateEmailDefault
        )

        #expect(template.channel == .email)
        #expect(template.subject == "Randevunuz oluşturuldu")
        #expect(template.body.contains("\n\n"))
    }

    @Test("Şablon listesi ÇIPLAK dizi olarak çözülür — `data` zarfı yok")
    func decodesTemplateListWithoutEnvelope() throws {
        let json = "[\(Fixtures.notificationTemplateDefault),\(Fixtures.notificationTemplateWhatsApp)]"
        let templates = try decode([NotificationTemplate].self, json)

        #expect(templates.count == 2)
        #expect(Set(templates.map(\.rowId)).count == 2)
    }

    // MARK: Tercihler

    @Test("Sessiz saat bir zaman damgası değil, `\"HH:MM\"` metni")
    func decodesPreferenceQuietHours() throws {
        let preference = try decode(
            NotificationPreference.self,
            Fixtures.notificationPreferenceDefault
        )

        #expect(preference.quietHoursStart == "21:00")
        #expect(preference.quietHoursEnd == "09:00")
        #expect(preference.quietHoursLabel == "21:00 – 09:00")
        #expect(preference.isDefault)
        #expect(preference.branchId == nil)
        #expect(preference.id == "appointment_cancelled|tenant")
    }

    @Test("Kanal önceliği gönderildiği sırada çözülür")
    func decodesPreferenceChannelOrder() throws {
        let preference = try decode(
            NotificationPreference.self,
            Fixtures.notificationPreferenceSaved
        )

        #expect(preference.channels == [.whatsapp, .sms])
        #expect(preference.isEnabled)
    }

    @Test("Boş kanal listesi \"olay kapalı\" demek")
    func emptyChannelsMeansDisabled() throws {
        let json = """
        {
          "id": null, "branchId": null, "event": "birthday", "kind": "marketing",
          "channels": [], "quietHoursStart": null, "quietHoursEnd": null, "isDefault": false
        }
        """
        let preference = try decode(NotificationPreference.self, json)

        #expect(!preference.isEnabled)
        #expect(preference.quietHoursLabel == nil)
        #expect(preference.kind == .marketing)
    }

    // MARK: Hatırlatma ve çizelge

    @Test("Şube override'ı yokken çözülmüş kiracı ayarı döner")
    func decodesResolvedReminderSettings() throws {
        let settings = try decode(
            BranchReminderSettings.self,
            Fixtures.reminderSettingsTenantDefault
        )

        #expect(settings.reminderHoursBefore == [24, 2])
        // Ayarın kiracıdan mı şubeden mi geldiğini YALNIZ bu alan söylüyor;
        // ekran onu göstermezse kullanıcı kiracı varsayılanını şubeye özel sanır.
        #expect(!settings.isBranchOverride)
        #expect(settings.hoursLabel == "24 saat önce, 2 saat önce")
    }

    @Test("Şube override'ı kaydedilince aynı uç `isBranchOverride: true` döner")
    func decodesBranchOverride() throws {
        let settings = try decode(
            BranchReminderSettings.self,
            Fixtures.reminderSettingsBranchOverride
        )

        #expect(settings.isBranchOverride)
        #expect(settings.reminderHoursBefore == [24, 4])
        #expect(settings.noShowFollowupDelayHours == 3)
    }

    @Test("Randevu çizelgesi ÇIPLAK dizi; `offsetHours` randevudan ÖNCE")
    func decodesAppointmentNotifications() throws {
        let rows = try decode([ScheduledNotification].self, Fixtures.appointmentNotifications)

        #expect(rows.count == 2)
        #expect(rows.allSatisfy { $0.status == .pending })
        #expect(rows.allSatisfy { !$0.isFollowup })
        #expect(rows.first?.offsetLabel == "Randevudan 24 saat önce")
        #expect(rows.first?.messageId == nil)
    }

    @Test("Negatif `offsetHours` gelmedi takibidir — randevudan SONRA")
    func negativeOffsetIsFollowup() throws {
        // Gövde biçimi yakalanan çizelgeyle aynı; yalnız `offsetHours`
        // negatife çevrildi. Tohum klinikte no-show randevusu yoktu.
        let json = """
        [{
          "id": "0d3b8f4b-0000-4000-8000-000000000001",
          "event": "no_show_followup",
          "offsetHours": -2,
          "scheduledFor": "2026-09-11T11:00:00.000Z",
          "status": "sent",
          "messageId": "cde431f8-13be-4a88-9303-dd27b369f570"
        }]
        """
        let row = try #require(try decode([ScheduledNotification].self, json).first)

        #expect(row.isFollowup)
        #expect(row.offsetLabel == "Randevudan 2 saat sonra")
        #expect(row.event == .noShowFollowup)
    }

    // MARK: Mesaj günlüğü

    @Test("Mesaj sayfası `{ data, pageInfo }` zarfıyla çözülür; adres maskeli")
    func decodesMessagePage() throws {
        let page = try decode(Page<Message>.self, Fixtures.messagePage)
        let message = try #require(page.data.first)

        #expect(page.pageInfo.hasMore == false)
        #expect(page.pageInfo.nextCursor == nil)
        #expect(message.to.hasPrefix("+90"))
        #expect(message.to.contains("*"))
        // `queued` + `attempt: 0`: mesaj üretildi ama HİÇ denenmedi.
        #expect(message.status == .queued)
        #expect(!message.wasAttempted)
        #expect(message.sentAt == nil)
        #expect(message.failureMessage == nil)
    }

    @Test("Bilinmeyen durum ve olay `unknown`a düşer, çözümleme patlamaz")
    func decodesUnknownEnums() throws {
        // Sunucu ileride yeni bir olay ya da durum ekleyebilir; eski bir
        // istemcinin tüm günlüğü çözememesi kabul edilemez. Bu yüzden gövde
        // BİLEREK bozuldu — kapalı kümelerin (``NotificationChannel``) aksine
        // bu ikisi açık.
        let json = """
        {
          "id": "cde431f8-13be-4a88-9303-dd27b369f570", "customerId": null, "userId": null,
          "channel": "whatsapp", "event": "loyalty_reward", "status": "expired",
          "to": "+90********67", "subject": null, "body": null, "errorCode": null,
          "attempt": 1, "scheduledFor": "2026-08-29T05:00:00.000Z",
          "sentAt": null, "deliveredAt": null, "createdAt": "2026-08-28T22:36:45.305Z"
        }
        """
        let message = try decode(Message.self, json)

        #expect(message.event == .unknown)
        #expect(message.status == .unknown)
    }

    @Test("Başarısız mesajın hata kodu kullanıcı diline çevrilir, ham kod korunur")
    func mapsErrorCodeToMessage() throws {
        let json = """
        {
          "id": "cde431f8-13be-4a88-9303-dd27b369f570", "customerId": null, "userId": null,
          "channel": "whatsapp", "event": "appointment_reminder", "status": "failed",
          "to": "+90********67", "subject": null, "body": null,
          "errorCode": "WHATSAPP_INVALID_RECIPIENT",
          "attempt": 1, "scheduledFor": "2026-08-29T05:00:00.000Z",
          "sentAt": null, "deliveredAt": null, "createdAt": "2026-08-28T22:36:45.305Z"
        }
        """
        let message = try decode(Message.self, json)

        #expect(message.status == .failed)
        #expect(message.errorCode == "WHATSAPP_INVALID_RECIPIENT")
        #expect(message.failureMessage?.contains("WhatsApp'ta geçerli değil") == true)
    }

    @Test("Tanınmayan hata kodu HAM haliyle gösterilir, yutulmaz")
    func keepsUnknownErrorCodeVisible() throws {
        // Kodu saklamak destek kaydını yok ederdi: operasyon "bir sorun oluştu"
        // ile sunucudaki gerçek sebebi eşleştiremez.
        let json = """
        {
          "id": "cde431f8-13be-4a88-9303-dd27b369f570", "customerId": null, "userId": null,
          "channel": "sms", "event": "appointment_reminder", "status": "failed",
          "to": "+90********67", "subject": null, "body": null,
          "errorCode": "SMS_PROVIDER_DOWN",
          "attempt": 3, "scheduledFor": "2026-08-29T05:00:00.000Z",
          "sentAt": null, "deliveredAt": null, "createdAt": "2026-08-28T22:36:45.305Z"
        }
        """
        let message = try decode(Message.self, json)

        #expect(message.failureMessage == "SMS_PROVIDER_DOWN")
    }

    // MARK: İletişim izni

    @Test("`channel: null` TÜM kanallar demek")
    func decodesOptOutAllChannels() throws {
        let record = try decode(OptOutRecord.self, Fixtures.optOutRecord)

        #expect(record.channel == nil)
        #expect(record.channelLabel == "Tüm kanallar")
        // Sunucu `kind`'ı sabit `marketing` yazıyor: işlemsel mesaj zaten
        // opt-out'tan etkilenmiyor.
        #expect(record.kind == .marketing)
        #expect(record.source == .customerRequest)
    }

    // MARK: WhatsApp

    @Test("Hesap yanıtında ham token YOK; yalnız maskeli hâli var")
    func whatsAppAccountNeverCarriesRawToken() throws {
        let account = try decode(WhatsAppAccount.self, Fixtures.whatsappAccountActive)

        #expect(account.status == .active)
        #expect(account.accessTokenMasked.hasPrefix("••••••••"))
        #expect(account.hasAppSecret)
        #expect(account.canVerifyWebhooks)
        #expect(account.lastVerifiedAt != nil)
        // Yanıtın tamamında token'ın kendisi geçmemeli — maskeli değer dört
        // karakterden fazlasını sızdırmıyor.
        #expect(!Fixtures.whatsappAccountActive.contains("EAAG"))
    }

    @Test("Meta şablonunun durumu küçük harf gelir; değişkenli şablon test edilemez")
    func decodesWhatsAppTemplates() throws {
        let templates = try decode([WhatsAppTemplate].self, Fixtures.whatsappTemplates)
        let template = try #require(templates.first)

        #expect(template.status == .approved)
        #expect(template.bodyVariableCount == 2)
        // Sunucu test gönderimini `parameters: []` ile yapıyor; değişken
        // bekleyen şablon Meta tarafından reddedilir.
        #expect(!template.isTestable)
        #expect(template.buttons.map(\.text) == ["Onayla", "İptal Et"])
        #expect(template.rowId == "randevu_hatirlatma|tr")
    }

    @Test("Doğrulama sonucu başarısızken de bir SONUÇtur, hata değil")
    func decodesVerifyResult() throws {
        let ok = try decode(WhatsAppVerifyResult.self, Fixtures.whatsappVerifyResult)
        #expect(ok.ok)
        #expect(ok.templateCount == 1)

        let failed = try decode(
            WhatsAppVerifyResult.self,
            #"{"ok": false, "error": "Invalid OAuth access token", "templateCount": 0}"#
        )
        #expect(!failed.ok)
        #expect(failed.error != nil)
    }

    @Test("Gelen kutusunun `messageType`'ı enum değil serbest metin")
    func decodesInboxItem() throws {
        // Meta'nın alanı serbest geçiyor; kapalı bir enum bilinmeyen bir türde
        // tüm gelen kutusunu çözemez hâle getirirdi.
        let json = """
        [{
          "id": "5c11e229-1a38-425a-92a2-aee85bb7427f",
          "customerId": null,
          "from": "+90********88",
          "messageType": "sticker",
          "body": null,
          "receivedAt": "2026-08-28T22:36:45.305Z",
          "handledAt": null
        }]
        """
        let item = try #require(try decode([InboxItem].self, json).first)

        #expect(item.messageType == "sticker")
        #expect(item.messageTypeLabel == "sticker")
        #expect(!item.isHandled)
        // Gövde boş gelebiliyor; listede boş satır göstermemek için tür
        // etiketine düşüyoruz.
        #expect(item.preview == "(sticker)")
    }

    // MARK: Hata kodları

    @Test("Faz 8 hata kodları çözülür ve kullanıcıya ne yapacağını söyler")
    func decodesPhase8Problems() throws {
        let templateInvalid = try decode(ProblemDetails.self, Fixtures.templateInvalidProblem)
        #expect(templateInvalid.code == .templateInvalid)
        // `detail` izinli değişkenleri sayıyor; genel bir cümle kullanıcıya
        // hangi adı yazacağını söylemezdi.
        #expect(APIError.problem(templateInvalid).displayMessage.contains("customerName"))

        let quietHours = try decode(ProblemDetails.self, Fixtures.quietHoursProblem)
        #expect(quietHours.code == .validationFailed)
        #expect(quietHours.status == 422)
    }

    @Test("Kota hatası GEÇİCİ; diğer WhatsApp hataları kalıcı")
    func rateLimitIsTheOnlyRetryableWhatsAppError() {
        func problem(_ code: APIErrorCode, status: Int) -> APIError {
            .problem(ProblemDetails(code: code, title: "", status: status))
        }

        #expect(problem(.whatsappRateLimited, status: 503).isRetryable)
        #expect(!problem(.whatsappTemplateNotApproved, status: 422).isRetryable)
        #expect(!problem(.whatsappInvalidRecipient, status: 422).isRetryable)
        #expect(!problem(.whatsappWindowClosed, status: 422).isRetryable)
        #expect(!problem(.optOut, status: 422).isRetryable)
    }
}
