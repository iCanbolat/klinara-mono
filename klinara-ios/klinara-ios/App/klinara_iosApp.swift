import SwiftUI

@main
struct KlinaraApp: App {

    /// Faz 1 uçları bağlanana kadar mock servis kullanılır.
    /// Canlıya geçiş burada tek satırdır: `MockAuthService()` → `LiveAuthService(...)`.
    private let auth = MockAuthService()

    var body: some Scene {
        WindowGroup {
            RootView(auth: auth)
                .tint(KlinaraColor.sage)
        }
    }
}
