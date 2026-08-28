import Foundation
import Testing
@testable import klinara_ios

/// Faz 8 store'larının ve bildirim mock'larının davranış testleri.
///
/// Sınanan şey ekran çizimi değil, **sunucunun kuralları**: hangi şablon
/// reddedilir, sessiz saatin iki ucu neden birlikte gider, hatırlatma
/// override'ı nasıl kalkar, sayfalama süzgeç değişince ne yapar. Mock bu
/// kuralları sunucudan farklı uygularsa arayüz canlıda ilk denemede yanılır
/// — Faz 6'da verilen kararın aynısı.
@MainActor
@Suite("Faz 8 store'ları")
struct Phase8StoreTests {

    private func graph() -> MockGraph { MockGraph() }

    private func settingsStore(_ mock: MockGraph) -> NotificationSettingsStore {
        NotificationSettingsStore(service: mock.notifications)
    }

    // MARK: Mesaj günlüğü

    @Test("İlk sayfa cursor bırakır; `loadMore` listeyi büyütür, sıfırlamaz")
    func paginatesMessages() async {
        let store = MessageLogStore(service: graph().messages)
        await store.load()

        let firstPage = store.messages
        #expect(!firstPage.isEmpty)
        let cursor = store.cursor
        #expect(cursor != nil)

        await store.loadMore()

        #expect(store.messages.count > firstPage.count)
        #expect(store.messages.prefix(firstPage.count).map(\.id) == firstPage.map(\.id))
    }

    @Test("Süzgeç değişince cursor SIFIRLANIR — eski cursor yeni süzgeçte anlamsız")
    func filterChangeResetsCursor() async {
        let store = MessageLogStore(service: graph().messages)
        await store.load()
        #expect(store.cursor != nil)

        await store.applyFilter(MessageFilter(status: .failed))

        // Tohumda tek bir `failed` satır var: tek sayfaya sığar, cursor kalmaz.
        #expect(store.cursor == nil)
        #expect(store.messages.allSatisfy { $0.status == .failed })
    }

    @Test("Aynı süzgeç yeniden uygulanınca yeniden yükleme yapılmaz")
    func idempotentFilter() async {
        let store = MessageLogStore(service: graph().messages)
        await store.load()
        let before = store.messages.map(\.id)

        await store.applyFilter(.none)

        #expect(store.messages.map(\.id) == before)
    }

    @Test("Günlük en yeni mesajı önce gösterir")
    func messagesAreNewestFirst() async {
        let store = MessageLogStore(service: graph().messages)
        await store.load()

        let dates = store.messages.map(\.createdAt)
        #expect(dates == dates.sorted(by: >))
    }

    @Test("Atlanmış mesaj günlükte KALIR — gitmedi mi, hiç denendi mi ayrımı")
    func skippedMessagesStayVisible() async {
        let store = MessageLogStore(service: graph().messages, filter: MessageFilter(status: .skipped))
        await store.load()

        let skipped = try? #require(store.messages.first)
        #expect(skipped?.status == .skipped)
        // Engel gönderimden ÖNCE oluştu: hiç denenmedi.
        #expect(skipped?.wasAttempted == false)
        #expect(skipped?.errorCode == APIErrorCode.optOut.rawValue)
    }

    // MARK: Gelen kutusu

    @Test("İşlendi işaretlenen satır, \"yalnız işlenmemişler\" süzgecinde listeden düşer")
    func markHandledRemovesRow() async throws {
        let store = InboxStore(service: graph().whatsapp)
        await store.load()

        let target = try #require(store.items.first { !$0.isHandled })
        let countBefore = store.items.count

        try await store.markHandled(id: target.id)

        #expect(store.items.count == countBefore - 1)
        #expect(!store.items.contains { $0.id == target.id })
    }

    @Test("\"Tümü\" süzgecinde işlendi işaretlenen satır kalır, damgalanır")
    func markHandledStampsRowWhenShowingAll() async throws {
        let store = InboxStore(service: graph().whatsapp)
        await store.setOnlyUnhandled(false)

        let target = try #require(store.items.first { !$0.isHandled })
        try await store.markHandled(id: target.id)

        let updated = try #require(store.items.first { $0.id == target.id })
        #expect(updated.isHandled)
    }

    @Test("Süzgeç işlenmişleri de gösterince liste büyür")
    func showingAllIncludesHandled() async {
        let store = InboxStore(service: graph().whatsapp)
        await store.load()
        let unhandledCount = store.items.count

        await store.setOnlyUnhandled(false)

        #expect(store.items.count > unhandledCount)
    }

    // MARK: Şablonlar

    @Test("Liste kod varsayılanlarıyla kiracı satırlarını BİRLEŞTİRİR")
    func templateListMergesDefaults() async {
        let store = settingsStore(graph())
        await store.loadTemplates()

        // Tohumda tek bir kiracı şablonu var; kalan satırlar varsayılan.
        let overrides = store.templates.filter { !$0.isDefault }
        #expect(overrides.count == 1)
        #expect(store.templates.count > overrides.count)
        // Aynı (olay, kanal, dil) iki kez listelenmemeli.
        #expect(Set(store.templates.map(\.rowId)).count == store.templates.count)
    }

    @Test("Tanımsız `{{değişken}}` TEMPLATE_INVALID ile reddedilir")
    func rejectsUnknownPlaceholder() async {
        let store = settingsStore(graph())
        await store.loadTemplates()

        await #expect(throws: APIError.self) {
            _ = try await store.upsertTemplate(UpsertNotificationTemplateInput(
                event: .appointmentReminder,
                channel: .sms,
                body: "Sayın {{musteriAdi}}, merhaba."
            ))
        }
    }

    @Test("Reddin kodu ve detayı sunucununkiyle aynı — kullanılabilir adları sayar")
    func templateInvalidCarriesAllowedNames() async throws {
        let store = settingsStore(graph())
        await store.loadTemplates()

        do {
            _ = try await store.upsertTemplate(UpsertNotificationTemplateInput(
                event: .birthday,
                channel: .sms,
                body: "{{packageName}} paketiniz."
            ))
            Issue.record("reddedilmeliydi")
        } catch let error as APIError {
            #expect(error.code == .templateInvalid)
            #expect(error.displayMessage.contains("customerName"))
        }
    }

    @Test("Konu yalnız e-posta kanalında kabul edilir")
    func subjectOnlyOnEmail() async {
        let store = settingsStore(graph())
        await store.loadTemplates()

        await #expect(throws: APIError.self) {
            _ = try await store.upsertTemplate(UpsertNotificationTemplateInput(
                event: .appointmentReminder,
                channel: .sms,
                subject: "Hatırlatma",
                body: "Sayın {{customerName}}, merhaba."
            ))
        }
    }

    @Test("Kaydedilen şablon varsayılanı EZER, listeye ikinci satır eklemez")
    func upsertReplacesDefaultRow() async throws {
        let store = settingsStore(graph())
        await store.loadTemplates()
        let countBefore = store.templates.count

        let saved = try await store.upsertTemplate(UpsertNotificationTemplateInput(
            event: .appointmentCancelled,
            channel: .sms,
            body: "Sayın {{customerName}}, randevunuz iptal edildi."
        ))

        #expect(store.templates.count == countBefore)
        #expect(!saved.isDefault)
        let row = try #require(store.templates.first { $0.rowId == saved.rowId })
        #expect(!row.isDefault)
        #expect(row.templateId != nil)
    }

    @Test("WhatsApp konumsal değişkenleri de beyaz listeye tabi")
    func whatsAppVariablesAreValidatedToo() async {
        let store = settingsStore(graph())
        await store.loadTemplates()

        await #expect(throws: APIError.self) {
            _ = try await store.upsertTemplate(UpsertNotificationTemplateInput(
                event: .appointmentReminder,
                channel: .whatsapp,
                body: "Meta şablonu kullanılıyor.",
                whatsappTemplateName: "randevu_hatirlatma",
                whatsappVariables: ["musteriAdi"]
            ))
        }
    }

    // MARK: Tercihler

    @Test("Sessiz saatin yalnız bir ucu VALIDATION_FAILED verir")
    func quietHoursMustComeInPairs() async throws {
        let store = settingsStore(graph())
        await store.loadPreferences()

        do {
            _ = try await store.upsertPreference(UpsertNotificationPreferenceInput(
                event: .appointmentReminder,
                channels: [.whatsapp],
                quietHoursStart: "22:00"
            ))
            Issue.record("reddedilmeliydi")
        } catch let error as APIError {
            #expect(error.code == .validationFailed)
        }
    }

    @Test("İki uç birlikte gönderilince kabul edilir ve sıra korunur")
    func acceptsQuietHoursPair() async throws {
        let store = settingsStore(graph())
        await store.loadPreferences()

        let saved = try await store.upsertPreference(UpsertNotificationPreferenceInput(
            event: .appointmentConfirmation,
            channels: [.email, .whatsapp],
            quietHoursStart: "23:00",
            quietHoursEnd: "07:30"
        ))

        #expect(saved.channels == [.email, .whatsapp])
        #expect(saved.quietHoursLabel == "23:00 – 07:30")
    }

    @Test("Şube satırı kiracı satırının YANINDA durur, yerine geçmez")
    func branchPreferenceCoexistsWithTenantDefault() async throws {
        let store = settingsStore(graph())
        await store.loadPreferences()
        let tenantCountBefore = store.tenantPreferences.count

        _ = try await store.upsertPreference(UpsertNotificationPreferenceInput(
            branchId: MockGraph.branchId,
            event: .appointmentReminder,
            channels: [.sms]
        ))

        #expect(store.tenantPreferences.count == tenantCountBefore)
        #expect(store.branchPreferences(branchId: MockGraph.branchId).count == 1)
    }

    // MARK: Hatırlatma ayarları

    @Test("Override'ı olmayan şube kiracı ayarını çözülmüş olarak alır")
    func resolvesTenantDefaultForBranchWithoutOverride() async {
        let store = settingsStore(graph())
        await store.loadReminderSettings(branchId: MockIDs.branchBagdat)

        let settings = store.reminderSettings
        #expect(settings?.reminderHoursBefore == MockNotificationsSeed.tenantReminderHours)
        #expect(settings?.isBranchOverride == false)
    }

    @Test("Override'ı olan şubede kendi saatleri geçerli")
    func usesBranchOverrideWhenPresent() async {
        let store = settingsStore(graph())
        await store.loadReminderSettings(branchId: MockGraph.branchId)

        #expect(store.reminderSettings?.isBranchOverride == true)
        #expect(store.reminderSettings?.reminderHoursBefore == [24, 4])
    }

    @Test("Boş dizi override'ı KALDIRIR — \"hiç hatırlatma yok\" demek değil")
    func emptyArrayRemovesOverride() async throws {
        let store = settingsStore(graph())
        await store.loadReminderSettings(branchId: MockGraph.branchId)

        let saved = try await store.updateReminderSettings(
            branchId: MockGraph.branchId,
            UpdateBranchReminderSettingsInput(reminderHoursBefore: [])
        )

        #expect(!saved.isBranchOverride)
        #expect(saved.reminderHoursBefore == MockNotificationsSeed.tenantReminderHours)
    }

    @Test("Beşten fazla hatırlatma ve sınır dışı saat reddedilir")
    func validatesReminderHours() async {
        let store = settingsStore(graph())
        await store.loadReminderSettings(branchId: MockGraph.branchId)

        await #expect(throws: APIError.self) {
            _ = try await store.updateReminderSettings(
                branchId: MockGraph.branchId,
                UpdateBranchReminderSettingsInput(reminderHoursBefore: [1, 2, 3, 4, 5, 6])
            )
        }
        await #expect(throws: APIError.self) {
            _ = try await store.updateReminderSettings(
                branchId: MockGraph.branchId,
                UpdateBranchReminderSettingsInput(reminderHoursBefore: [1000])
            )
        }
    }

    @Test("Kısmi güncelleme diğer alanlara dokunmaz")
    func partialUpdateKeepsOtherFields() async throws {
        let store = settingsStore(graph())
        await store.loadReminderSettings(branchId: MockGraph.branchId)

        let saved = try await store.updateReminderSettings(
            branchId: MockGraph.branchId,
            UpdateBranchReminderSettingsInput(noShowFollowupDelayHours: 6)
        )

        #expect(saved.reminderHoursBefore == [24, 4])
        #expect(saved.noShowFollowupDelayHours == 6)
        #expect(saved.noShowFollowupEnabled)
    }

    // MARK: Randevu çizelgesi

    @Test("Çizelge şube hatırlatma ayarından türer")
    func appointmentScheduleFollowsBranchSettings() async throws {
        let mock = graph()
        let created = try await mock.booking.create(
            mock.createInput(at: mock.workingTuesday(hour: 14)),
            idempotencyKey: UUID().uuidString
        )

        let rows = try await mock.notifications.appointmentNotifications(
            appointmentId: created.id
        )

        #expect(rows.map(\.offsetHours) == [24, 4])
        #expect(rows.allSatisfy { $0.event == .appointmentReminder })
    }

    @Test("İptal edilen randevunun çizelgesi SİLİNMEZ, `cancelled` görünür")
    func cancelledAppointmentKeepsScheduleVisible() async throws {
        let mock = graph()
        let created = try await mock.booking.create(
            mock.createInput(at: mock.workingTuesday(hour: 15)),
            idempotencyKey: UUID().uuidString
        )
        _ = try await mock.booking.cancel(id: created.id, reason: "Müşteri talebi")

        let rows = try await mock.notifications.appointmentNotifications(
            appointmentId: created.id
        )

        // "Randevu iptal edildi, hatırlatma ne oldu?" sorusunun cevabı burada
        // duruyor; satırları gizlemek onu cevapsız bırakırdı.
        #expect(!rows.isEmpty)
        #expect(rows.allSatisfy { $0.status == .cancelled })
    }

    // MARK: İletişim izni

    @Test("Aynı kapsamda ikinci iptal HATA değil; var olan kayıt döner")
    func optOutIsIdempotent() async throws {
        let mock = graph()
        let store = CustomerOptOutStore(
            service: mock.notifications,
            customerId: MockCustomerSeed.zeynep
        )
        await store.load()

        try await store.optOut(channel: nil, source: .staff, note: nil)
        let countAfterFirst = store.records.count
        try await store.optOut(channel: nil, source: .staff, note: nil)

        #expect(store.records.count == countAfterFirst)
        #expect(store.blocksAllChannels)
    }

    @Test("Kanal bazlı iptal tüm kanalları kapatmaz")
    func channelScopedOptOut() async throws {
        let mock = graph()
        let store = CustomerOptOutStore(
            service: mock.notifications,
            customerId: MockCustomerSeed.burak
        )
        await store.load()

        try await store.optOut(channel: .sms, source: .customerRequest, note: nil)

        #expect(store.isOptedOut)
        #expect(!store.blocksAllChannels)
        #expect(store.records.first?.channel == .sms)
    }

    @Test("Geri alma kaydı listeden düşürür")
    func revokeRemovesRecord() async throws {
        let mock = graph()
        let store = CustomerOptOutStore(
            service: mock.notifications,
            customerId: MockCustomerSeed.mehmet
        )
        await store.load()
        #expect(store.isOptedOut)

        try await store.revoke(channel: nil)

        #expect(!store.isOptedOut)
    }

    // MARK: WhatsApp

    @Test("Kaydedilen token yanıtta MASKELİ döner, ham hâli hiçbir yerde yok")
    func accessTokenIsNeverReadBack() async throws {
        let store = WhatsAppStore(service: graph().whatsapp)
        await store.loadAccount()

        let saved = try await store.upsertAccount(UpsertWhatsAppAccountInput(
            wabaId: "1029384756",
            phoneNumberId: "5647382910",
            accessToken: "EAAG-cok-gizli-erisim-tokeni-a91f"
        ))

        #expect(saved.accessTokenMasked == "••••••••a91f")
        #expect(!saved.accessTokenMasked.contains("EAAG"))
    }

    @Test("Kaydetmek hesabı DOĞRULANMAMIŞ duruma düşürür")
    func savingResetsVerification() async throws {
        let store = WhatsAppStore(service: graph().whatsapp)
        await store.loadAccount()
        #expect(store.account?.status == .active)

        _ = try await store.upsertAccount(UpsertWhatsAppAccountInput(
            wabaId: "9999",
            phoneNumberId: "8888",
            accessToken: "EAAG-yeni-token-b2c3"
        ))

        // Yeni kimlik bilgileri henüz Meta'ya karşı sınanmadı; eski "bağlı"
        // rozetini bırakmak yanlış bir güven verirdi.
        #expect(store.account?.status == .unconfigured)
        #expect(store.account?.lastVerifiedAt == nil)
        #expect(store.lastVerifyResult == nil)
    }

    @Test("Doğrulama hesabı `active` yapar ve şablonları senkronlar")
    func verifyActivatesAccount() async throws {
        let store = WhatsAppStore(service: graph().whatsapp)
        await store.loadAccount()
        _ = try await store.upsertAccount(UpsertWhatsAppAccountInput(
            wabaId: "1029384756",
            phoneNumberId: "5647382910",
            accessToken: "EAAG-cok-gizli-erisim-tokeni-a91f"
        ))

        try await store.verify()

        #expect(store.lastVerifyResult?.ok == true)
        #expect(store.account?.status == .active)
        #expect(!store.templates.isEmpty)
    }

    @Test("Test gönderimi yalnız DEĞİŞKENSİZ onaylı şablonla mümkün")
    func onlyVariableFreeTemplatesAreTestable() async throws {
        let store = WhatsAppStore(service: graph().whatsapp)
        await store.loadTemplates()

        #expect(store.templates.count > store.testableTemplates.count)
        #expect(store.testableTemplates.allSatisfy { $0.bodyVariableCount == 0 })
        #expect(store.testableTemplates.allSatisfy { $0.status == .approved })

        await #expect(throws: APIError.self) {
            _ = try await store.sendTest(SendTestMessageInput(
                to: "+905321234567",
                templateName: "randevu_hatirlatma"
            ))
        }
    }

    @Test("Onay bekleyen şablon KALICI hata verir")
    func pendingTemplateIsPermanentFailure() async throws {
        let store = WhatsAppStore(service: graph().whatsapp)
        await store.loadTemplates()

        do {
            _ = try await store.sendTest(SendTestMessageInput(
                to: "+905321234567",
                templateName: "dogum_gunu"
            ))
            Issue.record("reddedilmeliydi")
        } catch let error as APIError {
            #expect(error.code == .whatsappTemplateNotApproved)
            #expect(!error.isRetryable)
        }
    }

    @Test("Test gönderimi mesaj günlüğüne MASKELİ numarayla düşer")
    func testSendIsRecordedInMessageLog() async throws {
        let mock = graph()
        let store = WhatsAppStore(service: mock.whatsapp)
        await store.loadTemplates()
        let log = MessageLogStore(service: mock.messages)
        await log.load()
        let idsBefore = Set(log.messages.map(\.id))

        let result = try await store.sendTest(SendTestMessageInput(
            to: "+905321234567",
            templateName: "baglanti_testi"
        ))
        #expect(result.accepted)

        await log.load()
        // Sayıya değil satıra bakıyoruz: günlük sayfalanıyor ve ilk sayfa
        // sabit boyda: yeni kayıt eklendiğinde toplam artmaz, en YENİ satır
        // değişir.
        let recorded = try #require(log.messages.first)
        #expect(!idsBefore.contains(recorded.id))
        #expect(recorded.channel == .whatsapp)
        // Numara mesaj günlüğünde de MASKELİ durur; ham adres hiçbir yerde yok.
        #expect(recorded.to.contains("*"))
        #expect(!recorded.to.contains("5321234"))
    }

    @Test("Kota aşımı GEÇİCİ hatadır — kullanıcıya tekrar deneme hakkı verilir")
    func rateLimitIsTransient() async throws {
        let store = WhatsAppStore(service: graph().whatsapp)
        await store.loadTemplates()
        let input = SendTestMessageInput(to: "+905321234567", templateName: "baglanti_testi")

        _ = try await store.sendTest(input)
        _ = try await store.sendTest(input)

        do {
            _ = try await store.sendTest(input)
            Issue.record("kota aşımı beklenmişti")
        } catch let error as APIError {
            #expect(error.code == .whatsappRateLimited)
            #expect(error.isRetryable)
        }
    }
}

/// ``NotificationTemplateForm``un yer tutucu doğrulaması — saf, sunucusuz.
///
/// Bu kontrol istemcide DURUYOR ki kullanıcı hatayı kaydete basınca değil
/// yazarken görsün; sunucu yine son söz sahibi. İki tarafın aynı beyaz listeyi
/// kullandığı buradan sınanıyor.
@MainActor
@Suite("Faz 8 şablon formu")
struct NotificationTemplateFormTests {

    private func template(
        event: NotificationEvent = .appointmentReminder,
        channel: NotificationChannel = .sms,
        body: String = "Sayın {{customerName}}, merhaba.",
        whatsappVariables: [String] = []
    ) -> NotificationTemplate {
        NotificationTemplate(
            templateId: nil,
            event: event,
            channel: channel,
            locale: "tr",
            kind: .transactional,
            subject: nil,
            body: body,
            whatsappTemplateName: nil,
            whatsappTemplateLanguage: nil,
            whatsappVariables: whatsappVariables,
            isActive: true,
            isDefault: true,
            variables: []
        )
    }

    @Test("Yer tutucular göründükleri sırada ve tekrarsız ayrıştırılır")
    func parsesPlaceholders() {
        let found = NotificationEventCatalog.placeholders(
            in: "{{customerName}} {{appointmentAt}} {{customerName}}"
        )
        #expect(found == ["customerName", "appointmentAt"])
    }

    @Test("Boşluklu yazım da tanınır")
    func toleratesWhitespaceInPlaceholder() {
        #expect(NotificationEventCatalog.placeholders(in: "{{ customerName }}") == ["customerName"])
    }

    @Test("Olayda tanımlı olmayan ad hatalı sayılır")
    func flagsUnknownPlaceholder() {
        let form = NotificationTemplateForm(editing: template(body: "{{musteriAdi}}"))

        #expect(form.unknownPlaceholders == ["musteriAdi"])
        #expect(!form.isValid)
    }

    @Test("Başka bir olayın değişkeni bu olayda geçersiz")
    func variablesAreScopedToEvent() {
        // `packageName` gerçek bir değişken ama yalnız paket olaylarında.
        let form = NotificationTemplateForm(
            editing: template(event: .appointmentReminder, body: "{{packageName}}")
        )

        #expect(form.unknownPlaceholders == ["packageName"])
    }

    @Test("WhatsApp konumsal değişkenleri de aynı beyaz listeye tabi")
    func validatesWhatsAppVariables() {
        let form = NotificationTemplateForm(editing: template(
            channel: .whatsapp,
            body: "Meta şablonu kullanılıyor.",
            whatsappVariables: ["customerName", "musteriAdi"]
        ))

        #expect(form.unknownPlaceholders == ["musteriAdi"])
    }

    @Test("Boş gövde kaydedilemez")
    func rejectsEmptyBody() {
        let form = NotificationTemplateForm(editing: template(body: "geçerli"))
        form.body = "   \n  "

        #expect(!form.isValid)
    }

    @Test("Meta şablon adı verildiyse dil de zorunlu")
    func templateNameRequiresLanguage() {
        let form = NotificationTemplateForm(editing: template(channel: .whatsapp))
        form.whatsappTemplateName = "randevu_hatirlatma"
        form.whatsappTemplateLanguage = ""

        #expect(!form.isValid)
    }

    @Test("Konu yalnız e-posta kanalında gövdeye konur")
    func subjectOnlyForEmail() {
        let sms = NotificationTemplateForm(editing: template(channel: .sms))
        sms.subject = "Konu"
        #expect(sms.input().subject == nil)

        let email = NotificationTemplateForm(editing: template(channel: .email))
        email.subject = "Konu"
        #expect(email.input().subject == "Konu")
    }

    @Test("Değişken eklemek formu kirletir ve sıra korunur")
    func appendingVariablesTracksOrder() {
        let form = NotificationTemplateForm(editing: template(channel: .whatsapp))
        #expect(!form.isDirty)

        form.addWhatsAppVariable("appointmentAt")
        form.addWhatsAppVariable("customerName")
        form.addWhatsAppVariable("appointmentAt")

        #expect(form.isDirty)
        // Aynı ad iki kez eklenmez; sıra Meta'nın `{{1}}, {{2}}`'si.
        #expect(form.whatsappVariables == ["appointmentAt", "customerName"])
    }
}
