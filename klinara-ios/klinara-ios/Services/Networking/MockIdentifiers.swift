import Foundation

/// Mock servislerin paylaştığı sabit kimlikler.
///
/// Katalog, personel ve takvim mock'ları birbirine referans veriyor
/// (personel yetkinliği bir hizmete, çalışma şablonu bir şubeye bağlı).
/// Kimlikler tek yerde durmazsa bu bağlar sessizce kopar ve mock veri
/// gerçekte olamayacak bir durumu temsil etmeye başlar.
enum MockIDs {

    /// `MockAuthService.Fixtures` ile aynı kiracı.
    static let tenant = "7f3d1a20-0000-4000-8000-000000000001"

    /// `MockAuthService.Fixtures.branchesOne/Many` ile birebir aynı.
    static let branchNisantasi = "b1000000-0000-4000-8000-000000000001"
    static let branchBagdat = "b1000000-0000-4000-8000-000000000002"

    /// `Fixtures.me` içindeki kullanıcı.
    static let userOwner = "u1000000-0000-4000-8000-000000000001"
    static let userPractitioner = "u1000000-0000-4000-8000-000000000002"
    static let userReceptionist = "u1000000-0000-4000-8000-000000000003"

    static func uuid() -> String { UUID().uuidString.lowercased() }
}
