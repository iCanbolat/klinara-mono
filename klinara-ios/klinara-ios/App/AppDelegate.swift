import UIKit
import UserNotifications

/// SwiftUI yaşam döngüsünün karşılamadığı iki şey için: APNs anahtarı ve
/// bildirime dokunma. İkisi de ``PushCoordinator``a iletilir; burada iş yok.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Kapalı uygulama bildirime dokunularak açıldığında da yakalansın diye
        // açılışın EN BAŞINDA kurulmalı.
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PushCoordinator.shared.didRegister(deviceToken: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: any Error
    ) {
        // Simülatörde ve push yetkisi olmayan imzada beklenen durum; uygulama
        // push'suz çalışmaya devam eder.
    }

    // MARK: UNUserNotificationCenterDelegate

    /// Uygulama öndeyken de afiş görünsün: başka ekrandaki personel yeni
    /// online randevuyu kaçırmasın. Takvim zaten soketten tazeleniyor.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let route = PushRoute(userInfo: response.notification.request.content.userInfo)
        await MainActor.run { PushCoordinator.shared.open(route) }
    }
}
