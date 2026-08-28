import SwiftUI

/// Gelen kutusu — müşterilerin WhatsApp'tan yazdığı serbest metinler.
///
/// **Sayfalama yok, bilerek**: `GET /inbox` cursor vermiyor, yalnız `limit`
/// alıyor. Sonsuz kaydırma taklidi yapan bir store, ikinci sayfayı hiç
/// getiremeyeceği hâlde kullanıcıya daha fazlası varmış gibi gösterirdi.
///
/// Rozet ya da arka plan yenileme de yok: sunucuda push kanalı kurulmadı
/// (Ek M) ve bir sayacın peşinden koşmak için periyodik yoklama, pili
/// gerçek bir kazanç olmadan tüketirdi.
@MainActor
@Observable
final class InboxStore {

    private let service: any WhatsAppService

    private(set) var state: LoadState<[InboxItem]> = .loading
    private(set) var isSaving = false

    /// `false` iken işlenmişler de listelenir.
    var onlyUnhandled = true

    init(service: any WhatsAppService) {
        self.service = service
    }

    var items: [InboxItem] { state.value ?? [] }

    var unhandledCount: Int { items.filter { !$0.isHandled }.count }

    func load() async {
        state = .loading
        do {
            state = .loaded(try await service.inbox(onlyUnhandled: onlyUnhandled, limit: nil))
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    func setOnlyUnhandled(_ value: Bool) async {
        guard value != onlyUnhandled else { return }
        onlyUnhandled = value
        await load()
    }

    /// Yanıt gövdesiz (`204`) geldiği için satır sunucudan yeniden okunmaz;
    /// yerel olarak damgalanır. Süzgeç "yalnız işlenmemişler" ise satır
    /// listeden düşer — yeniden yükleme çağırmak, kullanıcının kaydırma
    /// konumunu sıfırlardı.
    func markHandled(id: String) async throws {
        isSaving = true
        defer { isSaving = false }
        try await service.markInboxHandled(id: id)
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        var list = items
        let existing = list[index]
        if onlyUnhandled {
            list.remove(at: index)
        } else {
            list[index] = InboxItem(
                id: existing.id,
                customerId: existing.customerId,
                from: existing.from,
                messageType: existing.messageType,
                body: existing.body,
                receivedAt: existing.receivedAt,
                handledAt: Date()
            )
        }
        state = .loaded(list)
    }
}
