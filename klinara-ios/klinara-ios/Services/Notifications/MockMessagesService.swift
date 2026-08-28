import Foundation

/// Sunucu olmadan mesaj günlüğünü sürmek için bellek-içi defter.
///
/// **Gerçek cursor sayfalaması yapar.** Tek sayfa döndüren bir mock, ekranın
/// sonsuz kaydırmasını ve ``MessageLogStore``ın "süzgeç değişince cursor'u
/// sıfırla" davranışını sınanmaz bırakırdı — ikisi de sessizce bozulabilecek
/// yerler.
final class MockMessagesService: MessagesService, @unchecked Sendable {

    /// Sunucudaki `DEFAULT_PAGE_SIZE` ile aynı değil: mock'ta sayfa küçük
    /// olmalı ki beş satırlık tohumda bile ikinci sayfa gerçekten oluşsun.
    private static let defaultPageSize = 3

    private let lock = NSLock()
    private var records: [Message] = []

    init() {
        seed()
    }

    func reseed() {
        withLock { seed() }
    }

    private func seed() {
        records = MockNotificationsSeed.messages(at: Date())
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.3) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    /// Yeni bir mesaj üretildiğinde günlüğe düşsün diye — WhatsApp test
    /// gönderimi mock'u bunu çağırıyor. Gerçek sunucuda ikisi aynı
    /// `message_log` tablosuna yazıyor; mock'ta bağı kurmasak test gönderimi
    /// hiçbir yerde iz bırakmazdı.
    func record(_ message: Message) {
        withLock { records.insert(message, at: 0) }
    }

    func messages(
        cursor: String?,
        limit: Int?,
        filter: MessageFilter
    ) async throws -> Page<Message> {
        await latency()
        return withLock {
            // Sunucunun sırası: `created_at DESC, id DESC` — en yeni önce.
            let sorted = records
                .filter { matches($0, filter) }
                .sorted {
                    $0.createdAt == $1.createdAt ? $0.id > $1.id : $0.createdAt > $1.createdAt
                }
            let start = cursor.flatMap { key in
                sorted.firstIndex { "\($0.createdAt.timeIntervalSince1970)|\($0.id)" == key }
                    .map { $0 + 1 }
            } ?? 0
            let size = min(limit ?? Self.defaultPageSize, 200)
            let end = min(start + size, sorted.count)
            guard start < end else { return .empty }
            let page = Array(sorted[start..<end])
            let hasMore = end < sorted.count
            let next = hasMore
                ? page.last.map { "\($0.createdAt.timeIntervalSince1970)|\($0.id)" }
                : nil
            return Page(data: page, pageInfo: PageInfo(nextCursor: next, hasMore: hasMore))
        }
    }

    private func matches(_ message: Message, _ filter: MessageFilter) -> Bool {
        if let customerId = filter.customerId, message.customerId != customerId { return false }
        if let channel = filter.channel, message.channel != channel { return false }
        if let event = filter.event, message.event != event { return false }
        if let status = filter.status, message.status != status { return false }
        if let from = filter.from, let date = KlinaraCoding.parseTimestamp(from),
           message.createdAt < date {
            return false
        }
        if let to = filter.to, let date = KlinaraCoding.parseTimestamp(to),
           message.createdAt > date {
            return false
        }
        return true
    }
}
