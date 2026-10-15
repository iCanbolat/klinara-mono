import Foundation

/// APNs'in hangi ucuna gidileceği. Xcode'dan kurulan derleme `sandbox`,
/// TestFlight ve App Store `production` — sunucu kaydı buna göre yönlendirir.
nonisolated enum PushEnvironment: String, Encodable, Sendable {
    case sandbox
    case production

    static var current: PushEnvironment {
        #if DEBUG
        return .sandbox
        #else
        return .production
        #endif
    }
}

/// Bu oturumun push anahtarı — `PUT/DELETE push-devices/current`.
///
/// Kayıt sunucuda OTURUMA bağlı: çıkış yapılınca ya da oturum iptal edilince
/// cihaza bildirim gitmez. Çıkışta yine de silinir ki satır beklemesin.
protocol PushService: Sendable {
    func register(token: String, environment: PushEnvironment) async throws
    func unregister() async throws
}

struct LivePushService: PushService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func register(token: String, environment: PushEnvironment) async throws {
        try await client.send(APIRequest.put(
            "push-devices/current",
            body: RegisterPushDevice(platform: "ios", token: token, environment: environment)
        ))
    }

    func unregister() async throws {
        try await client.send(APIRequest.delete("push-devices/current"))
    }
}

/// Sunucusuz kurulum: kayıt hiçbir yere gitmez.
struct MockPushService: PushService {
    func register(token: String, environment: PushEnvironment) async throws {}
    func unregister() async throws {}
}

nonisolated private struct RegisterPushDevice: Encodable, Sendable {
    let platform: String
    let token: String
    let environment: PushEnvironment
}
