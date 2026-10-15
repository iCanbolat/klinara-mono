import SwiftUI
import UserNotifications

/// Bildirime dokununca açılacak yer. Push yükü yalnız KİMLİK taşır;
/// müşteri adı ya da mesaj metni yükte yok (kilit ekranında sağlık verisi
/// görünmemeli) — ayrıntı uygulamanın içinde, yetkiyle okunur.
nonisolated enum PushRoute: Equatable, Sendable {
    case appointment(id: String)
    /// Hedefi olmayan bildirim (ör. WhatsApp mesajı): uygulama açılır, o kadar.
    case home

    init(userInfo: [AnyHashable: Any]) {
        if let id = userInfo["appointmentId"] as? String, !id.isEmpty {
            self = .appointment(id: id)
        } else {
            self = .home
        }
    }
}

/// Push yaşam döngüsünün tek sahibi.
///
/// APNs anahtarı `AppDelegate`ten, oturum ``AppSession``dan gelir; ikisi
/// farklı zamanlarda hazır olur (anahtar oturumdan önce de, sonra da
/// gelebilir). Kayıt ikisi birden elde olduğunda yapılır.
///
/// İzin YALNIZ oturum açıldıktan sonra istenir: giriş ekranında "bildirim
/// göndermek istiyor" sormak, kullanıcıya henüz neyin bildirileceğini
/// söylemeden izin istemek olurdu.
@MainActor
@Observable
final class PushCoordinator {

    static let shared = PushCoordinator()

    /// Bildirime dokunuldu; kabuk bunu tüketip `nil`e çeker.
    var pendingRoute: PushRoute?

    @ObservationIgnored private var deviceToken: String?
    @ObservationIgnored private var service: (any PushService)?
    @ObservationIgnored private var registeredToken: String?

    private init() {}

    // MARK: Oturum

    /// Oturum açıldı (ya da uygulama oturumla açıldı).
    func activate(service: any PushService) async {
        self.service = service
        registeredToken = nil

        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }
        let granted = await center.notificationSettings().authorizationStatus
        guard granted == .authorized || granted == .provisional || granted == .ephemeral else {
            return
        }
        // Anahtar her açılışta yeniden istenir: Apple anahtarı değiştirebilir.
        UIApplication.shared.registerForRemoteNotifications()
        await registerIfReady()
    }

    /// Çıkıştan ÖNCE çağrılır — silme isteği hâlâ geçerli token'la gitmeli.
    func deactivate() async {
        let service = self.service
        self.service = nil
        registeredToken = nil
        try? await service?.unregister()
    }

    // MARK: AppDelegate köprüsü

    func didRegister(deviceToken data: Data) {
        deviceToken = data.map { String(format: "%02x", $0) }.joined()
        Task { await registerIfReady() }
    }

    func open(_ route: PushRoute) {
        pendingRoute = route
    }

    private func registerIfReady() async {
        guard let service, let deviceToken, registeredToken != deviceToken else { return }
        do {
            try await service.register(token: deviceToken, environment: .current)
            registeredToken = deviceToken
        } catch {
            // Bir sonraki açılışta yeniden denenir; push bir yan kanal.
        }
    }
}
