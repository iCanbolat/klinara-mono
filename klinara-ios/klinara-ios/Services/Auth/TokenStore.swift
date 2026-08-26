import Foundation
import Security

/// Oturum token'larının kalıcı deposu.
///
/// Token'lar **Keychain'de** durur; `UserDefaults` bir yedekleme dosyasında
/// düz metin olarak durur ve oturum sırrı için uygun değildir.
///
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`:
/// - *AfterFirstUnlock* — arka planda token yenileme cihaz kilitliyken de çalışır.
/// - *ThisDeviceOnly* — token yedekle başka cihaza taşınmaz.
final class TokenStore: @unchecked Sendable {

    static let shared = TokenStore()

    private let service = "app.klinara.auth"
    private let account = "session"
    private let lock = NSLock()

    private struct Persisted: Codable {
        let accessToken: String
        let refreshToken: String
        let expiresAt: Date
        var tenantId: String?
        var branchId: String?
    }

    private var cache: Persisted?

    init() {
        cache = load()
    }

    // MARK: Okuma

    var hasSession: Bool {
        lock.lock(); defer { lock.unlock() }
        return cache != nil
    }

    var accessToken: String? {
        lock.lock(); defer { lock.unlock() }
        return cache?.accessToken
    }

    var refreshToken: String? {
        lock.lock(); defer { lock.unlock() }
        return cache?.refreshToken
    }

    var tenantId: String? {
        lock.lock(); defer { lock.unlock() }
        return cache?.tenantId
    }

    /// Şube kapsamlı uçlarda `X-Branch-Id` başlığı olarak gönderilir.
    var branchId: String? {
        lock.lock(); defer { lock.unlock() }
        return cache?.branchId
    }

    /// Access token'ın ömrü 15 dakikadır. Son 60 saniyede yenileme
    /// **önden** tetiklenir; istek 401 alana kadar beklenmez.
    var needsRefresh: Bool {
        lock.lock(); defer { lock.unlock() }
        guard let cache else { return false }
        return cache.expiresAt.timeIntervalSinceNow < 60
    }

    // MARK: Yazma

    func save(_ tokens: AuthTokens, tenantId: String? = nil) {
        lock.lock()
        let persisted = Persisted(
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: Date().addingTimeInterval(TimeInterval(tokens.expiresIn)),
            tenantId: tenantId ?? cache?.tenantId,
            branchId: cache?.branchId
        )
        cache = persisted
        lock.unlock()
        persist(persisted)
    }

    func setBranch(_ branchId: String?) {
        lock.lock()
        guard var updated = cache else { lock.unlock(); return }
        updated.branchId = branchId
        cache = updated
        lock.unlock()
        persist(updated)
    }

    func setTenant(_ tenantId: String?) {
        lock.lock()
        guard var updated = cache else { lock.unlock(); return }
        updated.tenantId = tenantId
        cache = updated
        lock.unlock()
        persist(updated)
    }

    func clear() {
        lock.lock()
        cache = nil
        lock.unlock()
        SecItemDelete(baseQuery() as CFDictionary)
    }

    // MARK: Keychain

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private func persist(_ value: Persisted) {
        guard let data = try? JSONEncoder().encode(value) else { return }

        // Upsert: önce güncellemeyi dene, kayıt yoksa ekle.
        let updated = SecItemUpdate(
            baseQuery() as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        guard updated == errSecItemNotFound else { return }

        var insert = baseQuery()
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(insert as CFDictionary, nil)
    }

    private func load() -> Persisted? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let decoded = try? JSONDecoder().decode(Persisted.self, from: data)
        else { return nil }

        // Refresh token 30 gün yaşar; access süresi dolmuşsa kayıt yine
        // kullanışlıdır — yenilemeye gideriz, kullanıcıyı çıkarmayız.
        return decoded
    }
}
