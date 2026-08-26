import SwiftUI

@main
struct KlinaraApp: App {

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
