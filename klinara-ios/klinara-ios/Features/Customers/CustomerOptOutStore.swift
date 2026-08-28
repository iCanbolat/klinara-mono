import SwiftUI

/// Bir müşterinin iletişim izni kayıtları.
///
/// Müşteri okuma modeli bu bilgiyi **taşımıyor** (sunucuda `crm` modülü
/// `contact_opt_outs` tablosuna hiç bakmıyor), bu yüzden ayrı bir çağrı ve
/// ayrı bir store gerekiyor. Ayrıca ayrı bir izin istiyor: `notification:read`.
/// Bölüm bu izin yokken hiç çizilmez — boş bir kart göstermek, kullanıcıya
/// "bu müşterinin izin kaydı yok" demek olurdu; oysa bilmiyoruz.
@MainActor
@Observable
final class CustomerOptOutStore {

    private let service: any NotificationsService
    private let customerId: String

    private(set) var state: LoadState<[OptOutRecord]> = .loading
    private(set) var isSaving = false

    init(service: any NotificationsService, customerId: String) {
        self.service = service
        self.customerId = customerId
    }

    var records: [OptOutRecord] { state.value ?? [] }

    /// Tüm kanalları kapsayan bir kayıt var mı — kanal bazlı satırlardan farklı
    /// olarak bu, müşteriye hiçbir ticari iletinin gitmeyeceği anlamına gelir.
    var blocksAllChannels: Bool { records.contains { $0.channel == nil } }

    var isOptedOut: Bool { !records.isEmpty }

    func load() async {
        state = .loading
        do {
            state = .loaded(try await service.optOuts(customerId: customerId))
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    func optOut(channel: NotificationChannel?, source: OptOutSource, note: String?) async throws {
        _ = try await mutating {
            _ = try await service.createOptOut(
                customerId: customerId,
                CreateOptOutInput(channel: channel, source: source, note: note)
            )
            await load()
        }
    }

    func revoke(channel: NotificationChannel?) async throws {
        _ = try await mutating {
            try await service.revokeOptOut(customerId: customerId, channel: channel)
            await load()
        }
    }

    private func mutating<T>(_ work: () async throws -> T) async throws -> T {
        isSaving = true
        defer { isSaving = false }
        return try await work()
    }
}
