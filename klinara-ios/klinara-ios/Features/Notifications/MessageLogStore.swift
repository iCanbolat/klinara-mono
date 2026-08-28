import SwiftUI

/// Mesaj günlüğü — hangi bildirimin ne olduğu.
///
/// **Ekran ömürlü**: günlük bir teşhis aracı, günlük akışın parçası değil.
/// ``CommissionStore`` ile aynı gerekçe.
///
/// Süzgeç değiştiğinde cursor'un sıfırlanması bu tipin tek incelikli yeri:
/// eski cursor yeni süzgeçte anlamsızdır ve taşınırsa sayfa ortasından
/// başlayan, sebebi görünmeyen bir liste üretir.
@MainActor
@Observable
final class MessageLogStore {

    private let service: any MessagesService

    private(set) var state: LoadState<[Message]> = .loading
    private(set) var cursor: String?
    private(set) var isLoadingMore = false

    /// Süzgeç doğrudan değiştirilmez; ``applyFilter(_:)`` cursor'u da sıfırlar.
    private(set) var filter: MessageFilter

    init(service: any MessagesService, filter: MessageFilter = .none) {
        self.service = service
        self.filter = filter
    }

    var messages: [Message] { state.value ?? [] }

    func load() async {
        state = .loading
        cursor = nil
        do {
            let page = try await service.messages(cursor: nil, limit: nil, filter: filter)
            state = .loaded(page.data)
            cursor = page.pageInfo.nextCursor
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    func loadMore() async {
        guard let cursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.messages(cursor: cursor, limit: nil, filter: filter)
            state = .loaded(messages + page.data)
            self.cursor = page.pageInfo.nextCursor
        } catch {
            // Sayfa eklemesi sessizce başarısız olur ve cursor korunur:
            // yüklenmiş listeyi bir hata ekranıyla değiştirmek, kullanıcının
            // okuduğu satırları elinden almak olurdu.
            self.cursor = cursor
        }
    }

    func applyFilter(_ filter: MessageFilter) async {
        guard filter != self.filter else { return }
        self.filter = filter
        await load()
    }

    func message(id: String) -> Message? {
        messages.first { $0.id == id }
    }
}
