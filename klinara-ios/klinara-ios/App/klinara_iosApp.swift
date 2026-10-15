import SwiftUI

@main
struct KlinaraApp: App {

    /// APNs anahtarı ve bildirime dokunma — bkz. ``AppDelegate``.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    /// Mock mu canlı mı — tek karar noktası ``ServiceContainer``.
    ///
    /// `ServiceContainer.live()` gerçek sunucuya bağlanır (kök
    /// `Info.plist` → `KlinaraAPIBaseURL`); `.mock()` sunucu olmadan
    /// arayüzü sürer ve geliştirici senaryo menüsünü açar.
    private let services = ServiceContainer.live()

    var body: some Scene {
        WindowGroup {
            RootView(services: services)
                .tint(KlinaraColor.sage)
        }
    }
}
