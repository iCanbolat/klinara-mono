import SwiftUI

/// Bildirim yapılandırması: şablonlar, tercihler ve şube hatırlatma ayarları.
///
/// **Ekran ömürlü** — ayda bir girilen ayar köşeleri (``CommissionStore`` ile
/// aynı gerekçe). Üç bağımsız ``LoadState``: kullanıcı yalnız hatırlatma
/// ayarına girdiğinde şablonların da yüklenmesini beklemesi gereksiz olurdu.
@MainActor
@Observable
final class NotificationSettingsStore {

    private let service: any NotificationsService

    private(set) var templatesState: LoadState<[NotificationTemplate]> = .loading
    private(set) var preferencesState: LoadState<[NotificationPreference]> = .loading
    private(set) var reminderState: LoadState<BranchReminderSettings> = .loading
    private(set) var isSaving = false

    init(service: any NotificationsService) {
        self.service = service
    }

    var templates: [NotificationTemplate] { templatesState.value ?? [] }
    var preferences: [NotificationPreference] { preferencesState.value ?? [] }
    var reminderSettings: BranchReminderSettings? { reminderState.value }

    /// Şablonlar olaya göre gruplu gösteriliyor: kanal kanal düz bir liste,
    /// "randevu hatırlatması hangi metinle gidiyor" sorusunu üç satıra bölerdi.
    var templatesByEvent: [(event: NotificationEvent, templates: [NotificationTemplate])] {
        let grouped = Dictionary(grouping: templates, by: \.event)
        return NotificationEvent.selectable.compactMap { event in
            guard let rows = grouped[event], !rows.isEmpty else { return nil }
            return (event, rows.sorted { $0.channel.rawValue < $1.channel.rawValue })
        }
    }

    /// Kiracı varsayılanları (`branchId == nil`).
    var tenantPreferences: [NotificationPreference] {
        preferences.filter { $0.branchId == nil }
    }

    /// Belirli bir şubeye yazılmış override'lar.
    func branchPreferences(branchId: String) -> [NotificationPreference] {
        preferences.filter { $0.branchId == branchId }
    }

    // MARK: Okuma

    func loadTemplates() async {
        templatesState = .loading
        do {
            templatesState = .loaded(try await service.templates())
        } catch {
            templatesState = .failed(error as? APIError ?? .network)
        }
    }

    func loadPreferences() async {
        preferencesState = .loading
        do {
            preferencesState = .loaded(try await service.preferences())
        } catch {
            preferencesState = .failed(error as? APIError ?? .network)
        }
    }

    func loadReminderSettings(branchId: String) async {
        reminderState = .loading
        do {
            reminderState = .loaded(try await service.reminderSettings(branchId: branchId))
        } catch {
            reminderState = .failed(error as? APIError ?? .network)
        }
    }

    // MARK: Yazma

    func upsertTemplate(
        _ input: UpsertNotificationTemplateInput
    ) async throws -> NotificationTemplate {
        try await mutating {
            let saved = try await service.upsertTemplate(input)
            // Liste birleştirilmiş etkin görünüm: sunucu varsayılan satırları
            // da hesaplıyor. Yerel yamalamak yerine yeniden okuyoruz, yoksa
            // bir varsayılanı ezmek listede iki satır bırakabilirdi.
            await loadTemplates()
            return saved
        }
    }

    func upsertPreference(
        _ input: UpsertNotificationPreferenceInput
    ) async throws -> NotificationPreference {
        try await mutating {
            let saved = try await service.upsertPreference(input)
            await loadPreferences()
            return saved
        }
    }

    func updateReminderSettings(
        branchId: String,
        _ input: UpdateBranchReminderSettingsInput
    ) async throws -> BranchReminderSettings {
        try await mutating {
            let saved = try await service.updateReminderSettings(branchId: branchId, input)
            reminderState = .loaded(saved)
            return saved
        }
    }

    private func mutating<T>(_ work: () async throws -> T) async throws -> T {
        isSaving = true
        defer { isSaving = false }
        return try await work()
    }
}
