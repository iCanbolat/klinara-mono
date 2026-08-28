import Foundation

/// Sunucu olmadan bildirim ayarı ekranlarını sürmek için bellek-içi defter.
///
/// Sunucunun dört davranışını taklit eder; sadece fixture döndürmek bu
/// ekranların asıl zor yerlerini sınanmaz bırakırdı:
///
/// - **Şablon listesi birleştirilmiş etkin görünüm**: kiracı satırı olmayan her
///   (olay, kanal) çifti kod varsayılanıyla, `isDefault: true` ve `id: nil` gelir.
/// - **Yer tutucu beyaz listesi**: olayda tanımlı olmayan `{{değişken}}`
///   ``APIErrorCode/templateInvalid`` ile reddedilir.
/// - **Sessiz saat ikilisi**: iki uçtan yalnız biri gönderilirse doğrulama hatası.
/// - **Hatırlatma çözümü**: şube override'ı yoksa kiracı ayarı döner ve
///   `isBranchOverride` bunu söyler; boş dizi override'ı KALDIRIR.
final class MockNotificationsService: NotificationsService, @unchecked Sendable {

    private let lock = NSLock()
    /// Randevu bildirim çizelgesi randevunun kendi saatinden türetiliyor;
    /// sabit bir tabloda tutmak, ertelenen bir randevuda çizelgeyi yalan
    /// söyletirdi.
    private let booking: any BookingService

    private var templateRecords: [NotificationTemplate] = []
    private var preferenceRecords: [NotificationPreference] = []
    private var branchReminderHours: [String: [Int]] = [:]
    private var branchFollowupEnabled: [String: Bool] = [:]
    private var branchFollowupDelay: [String: Int] = [:]
    private var optOutRecords: [OptOutRecord] = []

    init(booking: any BookingService) {
        self.booking = booking
        seed()
    }

    func reseed() {
        withLock { seed() }
    }

    private func seed() {
        templateRecords = MockNotificationsSeed.tenantTemplates()
        preferenceRecords = MockNotificationsSeed.tenantPreferences()
        branchReminderHours = MockNotificationsSeed.branchReminderOverrides()
        branchFollowupEnabled = [:]
        branchFollowupDelay = [:]
        optOutRecords = MockNotificationsSeed.optOuts(at: Date())
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.4) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    // MARK: Hatalar

    private func validation(_ detail: String) -> APIError {
        .problem(ProblemDetails(
            code: .validationFailed,
            title: "Geçersiz istek",
            detail: detail,
            status: 422
        ))
    }

    private func templateInvalid(_ unknown: [String], allowed: [String]) -> APIError {
        .problem(ProblemDetails(
            code: .templateInvalid,
            title: "Şablon geçersiz",
            detail: "Tanımsız değişken: \(unknown.joined(separator: ", ")). "
                + "Bu olayda kullanılabilecekler: \(allowed.joined(separator: ", "))",
            status: 422
        ))
    }

    // MARK: Şablonlar

    func templates() async throws -> [NotificationTemplate] {
        await latency(0.3)
        return withLock { mergedTemplates() }
    }

    /// Kod varsayılanları + kiracı override'ları. Sunucunun `notification-settings`
    /// servisinde yaptığı birleştirmenin aynısı.
    private func mergedTemplates() -> [NotificationTemplate] {
        var merged = MockNotificationsSeed.defaultTemplates()
        for record in templateRecords {
            if let index = merged.firstIndex(where: { $0.rowId == record.rowId }) {
                merged[index] = record
            } else {
                // Kod varsayılanı olmayan kanal (örn. WhatsApp) — listenin sonuna.
                merged.append(record)
            }
        }
        return merged
    }

    func upsertTemplate(
        _ input: UpsertNotificationTemplateInput
    ) async throws -> NotificationTemplate {
        await latency()
        return try withLock {
            let allowed = NotificationEventCatalog.variables(for: input.event)
            if input.channel != .email, input.subject?.isEmpty == false {
                throw validation("Konu yalnız e-posta kanalında kullanılabilir")
            }
            var used = NotificationEventCatalog.placeholders(in: input.body)
            if let subject = input.subject {
                used += NotificationEventCatalog.placeholders(in: subject)
            }
            used += input.whatsappVariables ?? []
            let unknown = used.filter { !allowed.contains($0) }
            guard unknown.isEmpty else {
                throw templateInvalid(Array(Set(unknown)).sorted(), allowed: allowed)
            }
            let locale = input.locale ?? "tr"
            let saved = NotificationTemplate(
                templateId: MockIDs.uuid(),
                event: input.event,
                channel: input.channel,
                locale: locale,
                kind: NotificationEventCatalog.kind(for: input.event),
                subject: input.subject,
                body: input.body,
                whatsappTemplateName: input.whatsappTemplateName,
                whatsappTemplateLanguage: input.whatsappTemplateLanguage,
                whatsappVariables: input.whatsappVariables ?? [],
                isActive: input.isActive ?? true,
                isDefault: false,
                variables: NotificationEventCatalog.placeholders(in: input.body)
            )
            let key = "\(input.event.rawValue)|\(input.channel.rawValue)|\(locale)"
            if let index = templateRecords.firstIndex(where: { $0.rowId == key }) {
                templateRecords[index] = saved
            } else {
                templateRecords.append(saved)
            }
            return saved
        }
    }

    // MARK: Tercihler

    func preferences() async throws -> [NotificationPreference] {
        await latency(0.3)
        return withLock {
            // Kiracı satırı OLMAYAN her olay için sentezlenmiş varsayılan +
            // tüm kayıtlı satırlar (kiracı ve şube). Sunucu da böyle döndürüyor.
            let tenantEvents = Set(
                preferenceRecords.filter { $0.branchId == nil }.map(\.event)
            )
            let synthesized = NotificationEvent.selectable
                .filter { !tenantEvents.contains($0) }
                .map(MockNotificationsSeed.defaultPreference(for:))
            return (synthesized + preferenceRecords)
                .sorted { $0.event.rawValue < $1.event.rawValue }
        }
    }

    func upsertPreference(
        _ input: UpsertNotificationPreferenceInput
    ) async throws -> NotificationPreference {
        await latency()
        return try withLock {
            let hasStart = input.quietHoursStart != nil
            let hasEnd = input.quietHoursEnd != nil
            guard hasStart == hasEnd else {
                throw validation("Sessiz saatin başlangıcı ve bitişi birlikte verilmeli")
            }
            let saved = NotificationPreference(
                preferenceId: MockIDs.uuid(),
                branchId: input.branchId,
                event: input.event,
                kind: NotificationEventCatalog.kind(for: input.event),
                channels: input.channels,
                quietHoursStart: input.quietHoursStart,
                quietHoursEnd: input.quietHoursEnd,
                isDefault: false
            )
            if let index = preferenceRecords.firstIndex(where: { $0.rowId == saved.rowId }) {
                preferenceRecords[index] = saved
            } else {
                preferenceRecords.append(saved)
            }
            return saved
        }
    }

    // MARK: Hatırlatma ayarları

    func reminderSettings(branchId: String) async throws -> BranchReminderSettings {
        await latency(0.3)
        return withLock { resolvedReminderSettings(branchId: branchId) }
    }

    private func resolvedReminderSettings(branchId: String) -> BranchReminderSettings {
        let override = branchReminderHours[branchId] ?? []
        return BranchReminderSettings(
            branchId: branchId,
            reminderHoursBefore: override.isEmpty
                ? MockNotificationsSeed.tenantReminderHours
                : override,
            isBranchOverride: !override.isEmpty,
            noShowFollowupEnabled: branchFollowupEnabled[branchId] ?? true,
            noShowFollowupDelayHours: branchFollowupDelay[branchId] ?? 2
        )
    }

    func updateReminderSettings(
        branchId: String,
        _ input: UpdateBranchReminderSettingsInput
    ) async throws -> BranchReminderSettings {
        await latency()
        return try withLock {
            if let hours = input.reminderHoursBefore {
                guard hours.count <= UpdateBranchReminderSettingsInput.maxReminderCount else {
                    throw validation("En çok 5 hatırlatma saati tanımlanabilir")
                }
                guard hours.allSatisfy({ UpdateBranchReminderSettingsInput.hourRange.contains($0) })
                else {
                    throw validation("Hatırlatma saatleri 1 ile 720 arasında olmalı")
                }
                // Boş dizi şube override'ını KALDIRIR; "hiç hatırlatma yok"
                // demek değil. Sunucu da bunu böyle yorumluyor.
                branchReminderHours[branchId] = hours
            }
            if let enabled = input.noShowFollowupEnabled {
                branchFollowupEnabled[branchId] = enabled
            }
            if let delay = input.noShowFollowupDelayHours {
                guard UpdateBranchReminderSettingsInput.followupDelayRange.contains(delay) else {
                    throw validation("Takip gecikmesi 0 ile 168 saat arasında olmalı")
                }
                branchFollowupDelay[branchId] = delay
            }
            return resolvedReminderSettings(branchId: branchId)
        }
    }

    // MARK: Randevu çizelgesi

    func appointmentNotifications(appointmentId: String) async throws -> [ScheduledNotification] {
        await latency(0.3)
        let appointment = try await booking.appointment(id: appointmentId)
        return withLock {
            let settings = resolvedReminderSettings(branchId: appointment.branchId)
            let now = Date()
            var rows = settings.reminderHoursBefore.sorted(by: >).map { hours in
                let fireAt = appointment.startsAt.addingTimeInterval(-Double(hours) * 3_600)
                return ScheduledNotification(
                    id: "\(appointmentId)|reminder|\(hours)",
                    event: .appointmentReminder,
                    offsetHours: hours,
                    scheduledFor: fireAt,
                    // Ek M: iş zamanı gelince koşuyor, satırı `pending`
                    // bulamazsa sessizce çıkıyor. İptal edilmiş randevuda
                    // satır bu yüzden `cancelled` görünür, silinmez.
                    status: cancelledStatus(for: appointment) ?? (fireAt < now ? .sent : .pending),
                    messageId: fireAt < now ? MockNotificationsSeed.messageReminderSent : nil
                )
            }
            if settings.noShowFollowupEnabled, appointment.status == .noShow {
                let delay = settings.noShowFollowupDelayHours
                let fireAt = appointment.endsAt.addingTimeInterval(Double(delay) * 3_600)
                rows.append(ScheduledNotification(
                    id: "\(appointmentId)|followup",
                    event: .noShowFollowup,
                    offsetHours: -delay,
                    scheduledFor: fireAt,
                    status: fireAt < now ? .sent : .pending,
                    messageId: nil
                ))
            }
            return rows
        }
    }

    private func cancelledStatus(for appointment: Appointment) -> ScheduledNotificationStatus? {
        appointment.status == .cancelled ? .cancelled : nil
    }

    // MARK: İletişim izni

    func optOuts(customerId: String) async throws -> [OptOutRecord] {
        await latency(0.2)
        return withLock { optOutRecords.filter { $0.customerId == customerId } }
    }

    func createOptOut(
        customerId: String,
        _ input: CreateOptOutInput
    ) async throws -> OptOutRecord {
        await latency()
        return withLock {
            // Sunucu bunu idempotent tutuyor: aynı kapsamda ikinci kayıt hata
            // değil, var olanı döndürür.
            if let existing = optOutRecords.first(where: {
                $0.customerId == customerId && $0.channel == input.channel
            }) {
                return existing
            }
            let created = OptOutRecord(
                id: MockIDs.uuid(),
                customerId: customerId,
                channel: input.channel,
                // Sunucu `kind`'ı sabit `marketing` yazıyor: işlemsel mesaj
                // zaten opt-out'tan etkilenmiyor.
                kind: .marketing,
                source: input.source ?? .customerRequest,
                createdAt: Date()
            )
            optOutRecords.append(created)
            return created
        }
    }

    func revokeOptOut(customerId: String, channel: NotificationChannel?) async throws {
        await latency()
        withLock {
            optOutRecords.removeAll {
                $0.customerId == customerId && (channel == nil || $0.channel == channel)
            }
        }
    }
}
