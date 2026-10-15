import Foundation

/// Sunucunun anlık olay kanalından gelen sinyal.
///
/// **İçerik taşımaz**: "şu şubenin şu günlerinde bir randevu değişti" der,
/// ekran veriyi yine yetkili REST ucundan okur. Web paneliyle aynı kanal
/// (`/api/v1/realtime`) ve aynı sözleşme.
nonisolated enum RealtimeEvent: Equatable, Sendable {
    /// `days`: şube saat diliminde yerel günler (`"2026-09-07"`).
    case calendarChanged(branchId: String, days: [String])
    case staffNotification(kind: String)
    /// Bağlantı koptu ve yeniden kuruldu: arada kaçan olay bilinemez, baştan oku.
    case resync
}

protocol RealtimeService: Sendable {
    /// Sokete bağlanmak için kısa ömürlü bilet — `POST realtime/ticket`.
    ///
    /// Erişim token'ı soketten geçmiyor: bilet yalnız bu kanalı açıyor ve
    /// URL'de değil, bağlandıktan sonraki ilk mesajda gönderiliyor (erişim
    /// loglarına düşmesin).
    func ticket() async throws -> String
    var socketURL: URL { get }
}

struct LiveRealtimeService: RealtimeService {

    private let client: APIClient
    let socketURL: URL

    init(client: APIClient, baseURL: URL = APIEnvironment.baseURL) {
        self.client = client
        self.socketURL = Self.socketURL(for: baseURL)
    }

    func ticket() async throws -> String {
        let response: RealtimeTicket = try await client.send(APIRequest.post("realtime/ticket"))
        return response.ticket
    }

    /// `https://…/api/v1` → `wss://…/api/v1/realtime`.
    static func socketURL(for baseURL: URL) -> URL {
        var components = URLComponents(
            url: baseURL.appending(path: "realtime"),
            resolvingAgainstBaseURL: false
        )
        components?.scheme = baseURL.scheme == "http" ? "ws" : "wss"
        return components?.url ?? baseURL
    }
}

nonisolated private struct RealtimeTicket: Decodable, Sendable {
    let ticket: String
}
