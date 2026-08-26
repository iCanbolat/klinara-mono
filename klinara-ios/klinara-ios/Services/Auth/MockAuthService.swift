import Foundation

/// Arayüzü sürmek için gereken senaryolar.
///
/// Her biri gerçek bir sunucu durumuna karşılık gelir; hepsi
/// `HomePlaceholderView` içindeki geliştirici menüsünden değiştirilebilir.
enum MockScenario: String, CaseIterable, Identifiable, Sendable {
    case happyPasskey = "Passkey ile tek dokunuş"
    case passwordOnly = "Telefon + parola"
    case passwordThenTotp = "Parola + TOTP"
    case mfaRequiredNotConfigured = "2FA zorunlu, kurulmamış"
    case multiTenant = "Birden çok klinik"
    case multiBranch = "Birden çok şube"
    case unverifiedPhone = "Telefon doğrulanmamış"
    case wrongPassword = "Hatalı bilgi"
    case accountLocked = "Hesap kilitli"
    case rateLimited = "Hız sınırı"
    case networkError = "Bağlantı hatası"

    var id: String { rawValue }
}

/// Sahte kimlik servisi.
///
/// Yanıtları Swift struct'ı olarak **kurmaz**, gerçek JSON üretip
/// `JSONDecoder` ile çözer. Böylece mock, canlı servise geçildiğinde
/// ortaya çıkacak bir çözümleme hatasını şimdiden yakalar.
final class MockAuthService: AuthService, @unchecked Sendable {

    private let lock = NSLock()
    private var _scenario: MockScenario
    private var _phoneVerified: Bool

    init(scenario: MockScenario = .passwordThenTotp) {
        _scenario = scenario
        _phoneVerified = scenario != .unverifiedPhone
    }

    /// `NSLock` doğrudan async bağlamdan çağrılamaz (Swift 6'da hata).
    /// Kilit senkron bir yardımcının içinde kalır.
    private func withLock<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    var scenario: MockScenario {
        get { withLock { _scenario } }
        set {
            withLock {
                _scenario = newValue
                _phoneVerified = newValue != .unverifiedPhone
            }
        }
    }

    // MARK: Yardımcılar

    /// Canlı istemciyle BİREBİR aynı çözücü — bkz. ``KlinaraCoding``.
    private static let decoder = KlinaraCoding.decoder()

    private func decode<T: Decodable>(_ json: String) throws -> T {
        do {
            return try Self.decoder.decode(T.self, from: Data(json.utf8))
        } catch {
            throw AuthError.malformedResponse(String(describing: error))
        }
    }

    /// Yükleme durumlarının gerçekten görünür olması için ağ gecikmesi.
    private func simulateLatency(_ seconds: Double = 0.7) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    private func problem(_ code: APIErrorCode, status: Int, title: String) -> AuthError {
        .problem(ProblemDetails(
            code: code,
            title: title,
            detail: nil,
            status: status,
            requestId: "01JQMOCK\(Int.random(in: 1000...9999))"
        ))
    }

    /// Senaryonun giriş denemesini baştan reddedip reddetmediği.
    private func failureForCurrentScenario() -> AuthError? {
        switch scenario {
        case .wrongPassword:
            return problem(.invalidCredentials, status: 401, title: "Giriş başarısız")
        case .accountLocked:
            return problem(.accountLocked, status: 423, title: "Hesap kilitli")
        case .rateLimited:
            return problem(.rateLimited, status: 429, title: "Çok fazla deneme")
        case .networkError:
            return .network
        default:
            return nil
        }
    }

    // MARK: - Giriş

    func login(
        email: String?,
        phone: String?,
        password: String,
        deviceLabel: String
    ) async throws -> LoginResponse {
        await simulateLatency()
        if let failure = failureForCurrentScenario() { throw failure }

        switch scenario {
        case .multiTenant:
            return try decode(Fixtures.tenantSelectionRequired)
        case .passwordThenTotp:
            return try decode(Fixtures.mfaRequired(configured: true))
        case .mfaRequiredNotConfigured:
            return try decode(Fixtures.mfaRequired(configured: false))
        default:
            return try decode(Fixtures.authenticated)
        }
    }

    func selectTenant(challengeToken: String, tenantId: String) async throws -> LoginResponse {
        await simulateLatency(0.5)
        return try decode(Fixtures.authenticated)
    }

    func verifyMfa(challengeToken: String, code: String, deviceLabel: String) async throws -> LoginResponse {
        await simulateLatency(0.5)
        // Yedek kodlar tire içerir; TOTP daima 6 hanedir.
        let isBackupCode = code.contains("-")
        guard isBackupCode || code.count == 6 else {
            throw problem(.mfaInvalid, status: 401, title: "Kod doğrulanamadı")
        }
        // Arayüzün hata yolunu da sürebilmek için sabit bir "yanlış" kod.
        guard code != "000000" else {
            throw problem(.mfaInvalid, status: 401, title: "Kod doğrulanamadı")
        }
        return try decode(Fixtures.authenticated)
    }

    // MARK: - TOTP kurulumu

    func totpSetup(challengeToken: String) async throws -> TotpSetup {
        await simulateLatency(0.4)
        return try decode(Fixtures.totpSetup)
    }

    func totpEnable(challengeToken: String, code: String) async throws -> [String] {
        await simulateLatency(0.5)
        guard code.count == 6, code != "000000" else {
            throw problem(.mfaInvalid, status: 401, title: "Kod doğrulanamadı")
        }
        return Fixtures.backupCodes
    }

    // MARK: - Passkey

    func passkeyAssertionOptions() async throws -> PasskeyOptions {
        await simulateLatency(0.3)
        return PasskeyOptions(
            challenge: Data((0..<32).map { _ in UInt8.random(in: 0...255) }),
            relyingPartyIdentifier: "klinara.app",
            userID: nil,
            userName: nil
        )
    }

    func passkeyVerify(_ assertion: PasskeyAssertion, deviceLabel: String) async throws -> LoginResponse {
        await simulateLatency(0.4)
        if case .networkError = scenario { throw AuthError.network }
        return try decode(Fixtures.authenticated)
    }

    func passkeyRegistrationOptions() async throws -> PasskeyOptions {
        await simulateLatency(0.3)
        return PasskeyOptions(
            challenge: Data((0..<32).map { _ in UInt8.random(in: 0...255) }),
            relyingPartyIdentifier: "klinara.app",
            userID: Data("mock-user".utf8),
            userName: "+905321234567"
        )
    }

    func registerPasskey(_ registration: PasskeyRegistration, deviceLabel: String) async throws {
        await simulateLatency(0.5)
    }

    // MARK: - Oturum sonrası

    func me() async throws -> MeResponse {
        await simulateLatency(0.3)
        let (verified, multipleBranches) = withLock { (_phoneVerified, _scenario == .multiBranch) }
        return try decode(Fixtures.me(phoneVerified: verified, multipleBranches: multipleBranches))
    }

    func branches() async throws -> [BranchSummary] {
        await simulateLatency(0.3)
        let json = scenario == .multiBranch ? Fixtures.branchesMany : Fixtures.branchesOne
        return try decode(json)
    }

    // MARK: - Telefon doğrulama

    func startPhoneVerification(phone: String) async throws -> PhoneVerificationStarted {
        await simulateLatency(0.5)
        let expiry = KlinaraCoding.timestamp(Date().addingTimeInterval(300))
        return try decode("""
        { "phone": "\(phone)", "expiresAt": "\(expiry)", "delivered": true }
        """)
    }

    func verifyPhone(code: String) async throws -> PhoneVerified {
        await simulateLatency(0.5)
        guard code.count == 6, code != "000000" else {
            throw problem(.verificationFailed, status: 400, title: "Kod doğrulanamadı")
        }
        withLock { _phoneVerified = true }
        let now = KlinaraCoding.timestamp(Date())
        return try decode("""
        { "phone": "+905321234567", "verifiedAt": "\(now)" }
        """)
    }

    // MARK: - Parola kurtarma

    func forgotPassword(email: String) async throws {
        await simulateLatency(0.8)
        // Sunucu, e-posta kayıtlı olsun ya da olmasın aynı yanıtı verir.
        // Mock da bu sözleşmeyi taklit eder: asla hata fırlatmaz.
    }

    // MARK: - Oturum

    func refresh(refreshToken: String) async throws -> AuthTokens {
        await simulateLatency(0.3)
        let response: LoginResponse = try decode(Fixtures.authenticated)
        guard let tokens = response.tokens else {
            throw AuthError.malformedResponse("refresh yanıtında tokens yok")
        }
        return tokens
    }

    func logout() async throws {
        await simulateLatency(0.2)
    }
}

// MARK: - JSON fixture'ları

private enum Fixtures {

    static let authenticated = """
    {
      "status": "authenticated",
      "tokens": {
        "accessToken": "mock.access.token",
        "refreshToken": "mock-opaque-refresh-token",
        "tokenType": "Bearer",
        "expiresIn": 900
      },
      "tenant": { "id": "7f3d1a20-0000-4000-8000-000000000001" }
    }
    """

    static let tenantSelectionRequired = """
    {
      "status": "tenant_selection_required",
      "challengeToken": "mock.tenant-select.token",
      "tenants": [
        {
          "id": "7f3d1a20-0000-4000-8000-000000000001",
          "slug": "nisantasi-estetik",
          "name": "Nişantaşı Estetik",
          "roles": ["practitioner"]
        },
        {
          "id": "7f3d1a20-0000-4000-8000-000000000002",
          "slug": "bodrum-medikal",
          "name": "Bodrum Medikal Güzellik",
          "roles": ["manager", "practitioner"]
        }
      ]
    }
    """

    static func mfaRequired(configured: Bool) -> String {
        """
        {
          "status": "mfa_required",
          "challengeToken": "mock.mfa.token",
          "mfa": {
            "configured": \(configured),
            "methods": \(configured ? "[\"totp\", \"backup_code\"]" : "[\"totp\"]")
          }
        }
        """
    }

    static let totpSetup = """
    {
      "secret": "JBSWY3DPEHPK3PXP",
      "otpauthUri": "otpauth://totp/Klinara:ayse%40klinik.com?secret=JBSWY3DPEHPK3PXP&issuer=Klinara"
    }
    """

    static let backupCodes = [
        "4f2a-9c1e", "8b3d-2e7a", "1c9f-6d4b", "7e5a-3f8c", "2d6b-1a9e",
        "9a4c-7b2f", "5f8e-4c3d", "3b7d-8e1a", "6c2f-5a9b", "0e1d-3c7f",
    ]

    static func me(phoneVerified: Bool, multipleBranches: Bool) -> String {
        let memberships = multipleBranches
            ? """
              [
                { "id": "m1", "branchId": "b1000000-0000-4000-8000-000000000001",
                  "roleKey": "practitioner", "roleName": "Uygulayıcı" },
                { "id": "m2", "branchId": "b1000000-0000-4000-8000-000000000002",
                  "roleKey": "practitioner", "roleName": "Uygulayıcı" }
              ]
              """
            : """
              [
                { "id": "m1", "branchId": "b1000000-0000-4000-8000-000000000001",
                  "roleKey": "practitioner", "roleName": "Uygulayıcı" }
              ]
              """
        let branchIds = multipleBranches
            ? "[\"b1000000-0000-4000-8000-000000000001\", \"b1000000-0000-4000-8000-000000000002\"]"
            : "[\"b1000000-0000-4000-8000-000000000001\"]"

        return """
        {
          "user": {
            "id": "u1000000-0000-4000-8000-000000000001",
            "email": "ayse.yilmaz@klinik.com",
            "fullName": "Ayşe Yılmaz",
            "locale": "tr-TR",
            "isActive": true,
            "phone": "+905321234567",
            "phoneVerified": \(phoneVerified),
            "hasPassword": true,
            "lastLoginAt": "2026-08-26T08:14:00.000Z",
            "createdAt": "2026-05-02T09:30:00.000Z",
            "memberships": \(memberships)
          },
          "tenantId": "7f3d1a20-0000-4000-8000-000000000001",
          "roles": ["practitioner"],
          "permissions": ["appointment:read.own", "customer:read"],
          "branchIds": \(branchIds),
          "tenantWide": false
        }
        """
    }

    static let branchesOne = """
    [
      {
        "id": "b1000000-0000-4000-8000-000000000001",
        "name": "Nişantaşı",
        "timezone": "Europe/Istanbul",
        "address": "Teşvikiye Cad. No: 12, Şişli",
        "isActive": true
      }
    ]
    """

    static let branchesMany = """
    [
      {
        "id": "b1000000-0000-4000-8000-000000000001",
        "name": "Nişantaşı",
        "timezone": "Europe/Istanbul",
        "address": "Teşvikiye Cad. No: 12, Şişli",
        "isActive": true
      },
      {
        "id": "b1000000-0000-4000-8000-000000000002",
        "name": "Bağdat Caddesi",
        "timezone": "Europe/Istanbul",
        "address": "Bağdat Cad. No: 244, Kadıköy",
        "isActive": true
      }
    ]
    """
}
