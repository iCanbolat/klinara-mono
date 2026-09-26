import SwiftUI

/// Sohbet listesi — web'deki Mesajlar ekranının sol sütunu.
///
/// Süzgeç değişince cursor SIFIRLANIR: eski cursor yeni süzgeçte anlamsız ve
/// taşınırsa sayfa ortasından başlayan bir liste üretirdi (``MessageLogStore``
/// ile aynı kural).
@MainActor
@Observable
final class ConversationListStore {

    private let service: any ConversationsService

    private(set) var state: LoadState<[Conversation]> = .loading
    private(set) var cursor: String?
    private(set) var isLoadingMore = false
    private(set) var loadMoreError: APIError?
    private(set) var filter: ConversationFilter

    init(service: any ConversationsService, filter: ConversationFilter = .open) {
        self.service = service
        self.filter = filter
    }

    var conversations: [Conversation] { state.value ?? [] }

    var unreadCount: Int { conversations.count { $0.unread } }

    func load() async {
        cursor = nil
        loadMoreError = nil
        do {
            let page = try await service.conversations(filter: filter, cursor: nil, limit: nil)
            state = .loaded(page.data)
            cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : nil
        } catch {
            // Yenilemede (`refreshable`, geri dönüş) yüklü liste korunur.
            if state.value == nil { state = .failed(error as? APIError ?? .network) }
        }
    }

    func loadMore() async {
        guard let cursor, !isLoadingMore, loadMoreError == nil else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.conversations(filter: filter, cursor: cursor, limit: nil)
            state = .loaded(conversations + page.data)
            self.cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : nil
        } catch {
            loadMoreError = error as? APIError ?? .network
        }
    }

    func retryLoadMore() async {
        loadMoreError = nil
        await loadMore()
    }

    func applyFilter(_ filter: ConversationFilter) async {
        guard filter != self.filter else { return }
        self.filter = filter
        state = .loading
        await load()
    }

    /// Akış ekranındaki değişiklik (okundu, kapatma, yeni mesaj) listeye yansır.
    /// Satır artık süzgece uymuyorsa listeden düşer.
    func update(_ conversation: Conversation) {
        guard var list = state.value else { return }
        let fits: Bool = switch filter {
        case .open: conversation.status == .open
        case .unread: conversation.status == .open && conversation.unread
        case .closed: conversation.status == .closed
        }
        if let index = list.firstIndex(where: { $0.id == conversation.id }) {
            if fits { list[index] = conversation } else { list.remove(at: index) }
        }
        state = .loaded(list)
    }
}
