import SwiftUI

/// Bir gün başlığı ve altındaki mesajlar.
///
/// Gruplama görünümde değil burada: "hangi gün" sorusunun cevabı şube saat
/// dilimine bağlı ve bir `ForEach` gövdesinde hesaplanırsa her yeniden çizimde
/// yeniden hesaplanır.
struct MessageDayGroup: Identifiable, Equatable {
    /// Şube saatinde günün başlangıcı — sıralama ve kimlik.
    let day: Date
    let title: String
    let messages: [Message]

    var id: Date { day }
}

/// Mesaj günlüğünün yüklenmiş satırları üzerinden çıkarılan sayaçlar.
///
/// **Kapsamı yüklenmiş sayfalardır**, tüm günlük değil: sunucuda sayaç ucu yok
/// ve açmıyoruz. Ekran bu yüzden kapsamı yazıyla söyler — yanlış bir toplam
/// göstermektense neyin sayıldığını söylemek.
struct MessageLogSummary: Equatable {
    var total = 0
    var failed = 0
    var skipped = 0

    init(_ messages: [Message] = []) {
        total = messages.count
        failed = messages.count { $0.status == .failed }
        skipped = messages.count { $0.status == .skipped }
    }
}

/// Mesaj günlüğü — hangi bildirimin ne olduğu.
///
/// **Ekran ömürlü**: günlük bir teşhis aracı, günlük akışın parçası değil.
///
/// Süzgeç değiştiğinde cursor'un sıfırlanması bu tipin tek incelikli yeri:
/// eski cursor yeni süzgeçte anlamsızdır ve taşınırsa sayfa ortasından
/// başlayan, sebebi görünmeyen bir liste üretir.
@MainActor
@Observable
final class MessageLogStore {

    private let service: any MessagesService
    private let clock: BranchClock

    private(set) var state: LoadState<[Message]> = .loading
    private(set) var cursor: String?
    private(set) var isLoadingMore = false

    /// Sonraki sayfa düştü. Satırlar KORUNUR; liste sonunda "Tekrar dene" çıkar.
    ///
    /// Hatayı yutmak ve cursor'u korumak, sondaki nöbetçi `onAppear`'ı bir daha
    /// tetiklemediği için sonsuza dek dönen bir spinner üretiyordu.
    private(set) var loadMoreError: APIError?

    /// Süzgeç doğrudan değiştirilmez; ``applyFilter(_:)`` cursor'u da sıfırlar.
    private(set) var filter: MessageFilter

    init(service: any MessagesService, clock: BranchClock, filter: MessageFilter = .none) {
        self.service = service
        self.clock = clock
        self.filter = filter
    }

    var messages: [Message] { state.value ?? [] }

    var summary: MessageLogSummary { MessageLogSummary(messages) }

    /// Güne göre gruplanmış satırlar — sunucu zaten en yeniden eskiye sıralı
    /// döndürüyor, bu yüzden görülme sırası korunur ve yeniden sıralanmaz.
    var groups: [MessageDayGroup] {
        var order: [Date] = []
        var byDay: [Date: [Message]] = [:]
        for message in messages {
            let day = clock.startOfDay(message.createdAt)
            if byDay[day] == nil { order.append(day) }
            byDay[day, default: []].append(message)
        }
        return order.map { day in
            MessageDayGroup(
                day: day,
                title: clock.relativeDayLabel(day),
                messages: byDay[day] ?? []
            )
        }
    }

    func load() async {
        state = .loading
        cursor = nil
        loadMoreError = nil
        do {
            let page = try await service.messages(cursor: nil, limit: nil, filter: filter)
            state = .loaded(page.data)
            cursor = page.pageInfo.nextCursor
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    func loadMore() async {
        guard let cursor, !isLoadingMore, loadMoreError == nil else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.messages(cursor: cursor, limit: nil, filter: filter)
            state = .loaded(messages + page.data)
            self.cursor = page.pageInfo.nextCursor
        } catch {
            // Yüklenmiş listeyi bir hata ekranıyla değiştirmek, kullanıcının
            // okuduğu satırları elinden almak olurdu; cursor korunur ve
            // "Tekrar dene" aynı sayfayı ister.
            loadMoreError = error as? APIError ?? .network
        }
    }

    func retryLoadMore() async {
        loadMoreError = nil
        await loadMore()
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
