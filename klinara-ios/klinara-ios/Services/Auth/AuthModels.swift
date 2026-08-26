import Foundation

// Bu dosyadaki tipler `apps/api/src/modules/identity/dto/` altındaki gerçek
// NestJS DTO'larından birebir türetilmiştir. Alan adları sunucudakiyle aynıdır;
// canlı servise geçildiğinde `JSONDecoder` ek eşleme olmadan çözer.

// MARK: - Giriş yanıtı

/// `LoginResponseDto.status` — giriş üç durumdan biriyle biter.
nonisolated enum LoginStatus: String, Decodable, Sendable {
    case authenticated
    case tenantSelectionRequired = "tenant_selection_required"
    case mfaRequired = "mfa_required"
}

/// `AuthTokensDto`. `refreshToken` opak bir değerdir; sunucuda yalnız sha256 özeti durur.
nonisolated struct AuthTokens: Decodable, Sendable, Equatable {
    let accessToken: String
    let refreshToken: String
    let tokenType: String
    /// Access token ömrü, saniye. Sunucu 900 (15 dk) döndürür.
    let expiresIn: Int
}

/// `TenantOptionDto` — kullanıcı birden çok klinikte üyeyse seçim listesi.
nonisolated struct TenantOption: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let slug: String
    let name: String
    let roles: [String]
}

/// `MfaChallengeDto`.
nonisolated struct MfaChallenge: Decodable, Sendable, Equatable {
    /// Kullanıcı TOTP kurulumunu tamamlamış mı. `false` + `mfaRequired`
    /// kombinasyonu, kiracı politikasının 2FA'yı zorunlu kıldığı ama
    /// kullanıcının henüz kurmadığı anlamına gelir — kurulum ekranı gerekir.
    let configured: Bool
    /// Örn. `["totp", "backup_code"]`.
    let methods: [String]

    var allowsBackupCode: Bool { methods.contains("backup_code") }
}

nonisolated struct SelectedTenant: Decodable, Sendable, Equatable {
    let id: String
}

/// `LoginResponseDto`. `tokens` **yalnız** `.authenticated` durumunda doludur.
nonisolated struct LoginResponse: Decodable, Sendable {
    let status: LoginStatus
    let tokens: AuthTokens?
    /// Ara token — kiracı seçimi ve 2FA adımlarında taşınır.
    let challengeToken: String?
    let tenants: [TenantOption]?
    let mfa: MfaChallenge?
    let tenant: SelectedTenant?
}

/// Giriş yanıtının **tip güvenli** hâli.
///
/// `LoginResponse` ekranlarda doğrudan tüketilmez: opsiyonel `tokens` alanı,
/// yarım kalmış bir oturumun yanlışlıkla tam yetkili sayılmasına açık kapı
/// bırakır. Bu enum'da yarım oturumun token'ı **tip olarak yoktur**.
nonisolated enum LoginOutcome: Sendable {
    case success(AuthTokens)
    case needsTenantSelection(challengeToken: String, tenants: [TenantOption])
    case needsMfa(challengeToken: String, challenge: MfaChallenge)
}

extension LoginResponse {
    /// Sunucu sözleşmesini enum'a indirger. Beklenen alanlar eksikse
    /// sessizce yanlış bir duruma düşmek yerine hata fırlatır.
    func outcome() throws -> LoginOutcome {
        switch status {
        case .authenticated:
            guard let tokens else { throw AuthError.malformedResponse("authenticated yanıtında tokens yok") }
            return .success(tokens)

        case .tenantSelectionRequired:
            guard let challengeToken, let tenants, !tenants.isEmpty else {
                throw AuthError.malformedResponse("tenant_selection_required yanıtı eksik")
            }
            return .needsTenantSelection(challengeToken: challengeToken, tenants: tenants)

        case .mfaRequired:
            guard let challengeToken, let mfa else {
                throw AuthError.malformedResponse("mfa_required yanıtı eksik")
            }
            return .needsMfa(challengeToken: challengeToken, challenge: mfa)
        }
    }
}

// MARK: - Kullanıcı

/// `MembershipResponseDto`. `branchId` nil ise üyelik kiracı kapsamlıdır.
nonisolated struct MembershipSummary: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let branchId: String?
    let roleKey: String
    let roleName: String
}

/// `UserResponseDto`.
nonisolated struct UserProfile: Decodable, Sendable, Equatable {
    let id: String
    let email: String
    let fullName: String
    let locale: String
    let isActive: Bool
    let phone: String?
    /// `false` ise numara giriş tanımlayıcısı **değildir** — doğrulanması gerekir.
    let phoneVerified: Bool
    /// Davet bekleyen hesapta `false`.
    let hasPassword: Bool
    let lastLoginAt: String?
    let createdAt: String
    let memberships: [MembershipSummary]
}

/// `MeResponseDto`. Dikkat: şube **adları** burada yoktur, yalnız kimlikleri —
/// isimler için `GET /branches` gerekir.
nonisolated struct MeResponse: Decodable, Sendable {
    let user: UserProfile
    let tenantId: String
    let roles: [String]
    let permissions: [String]
    let branchIds: [String]
    /// `true` ise kullanıcı kiracının **tüm** şubelerine erişir.
    let tenantWide: Bool
}

/// `BranchResponseDto`.
nonisolated struct BranchSummary: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let name: String
    let timezone: String
    let address: String?
    let isActive: Bool
}

// MARK: - TOTP

/// `TotpSetupResponseDto`.
nonisolated struct TotpSetup: Decodable, Sendable {
    let secret: String
    let otpauthUri: String
}

// MARK: - Telefon doğrulama

/// `PhoneVerificationStartedDto`.
nonisolated struct PhoneVerificationStarted: Decodable, Sendable {
    let phone: String
    /// Kodun son geçerlilik anı — geri sayım **bu değerden** sürülür,
    /// istemci tarafında ayrı bir 5 dakika sayacı tutulmaz.
    let expiresAt: Date
    let delivered: Bool
}

/// `PhoneVerifiedDto`.
nonisolated struct PhoneVerified: Decodable, Sendable {
    let phone: String
    let verifiedAt: Date
}

// MARK: - Passkey

/// WebAuthn seçenekleri sunucudan ham JSON olarak gelir ve doğrudan
/// `AuthenticationServices`'e aktarılır — istemci içeriğini yorumlamaz.
nonisolated struct PasskeyOptions: Sendable {
    let challenge: Data
    let relyingPartyIdentifier: String
    /// Kayıt akışında dolu, doğrulama akışında nil.
    let userID: Data?
    let userName: String?
}
