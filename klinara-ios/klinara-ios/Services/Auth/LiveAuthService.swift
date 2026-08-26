import Foundation

/// ``AuthService``'in gerçek uygulaması — Faz 1 uçlarına konuşur.
///
/// Protokol değişmediği için ekranlarda tek satır değişmez; mock ile canlı
/// arasındaki fark yalnız ``ServiceContainer``'da hangi örneğin kurulduğudur.
struct LiveAuthService: AuthService {

    /// ``ServiceContainer`` oturum düşme geri çağrısını bağlayabilsin diye görünür.
    let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    // MARK: - Giriş

    nonisolated private struct LoginBody: Encodable, Sendable {
        let email: String?
        let phone: String?
        let password: String
        let deviceLabel: String
    }

    func login(
        email: String?,
        phone: String?,
        password: String,
        deviceLabel: String
    ) async throws -> LoginResponse {
        var request = APIRequest.post(
            "auth/login",
            body: LoginBody(email: email, phone: phone, password: password, deviceLabel: deviceLabel)
        )
        request.requiresAuth = false
        return try await client.send(request)
    }

    nonisolated private struct SelectTenantBody: Encodable, Sendable {
        let challengeToken: String
        let tenantId: String
    }

    func selectTenant(challengeToken: String, tenantId: String) async throws -> LoginResponse {
        var request = APIRequest.post(
            "auth/tenant",
            body: SelectTenantBody(challengeToken: challengeToken, tenantId: tenantId)
        )
        request.requiresAuth = false
        return try await client.send(request)
    }

    nonisolated private struct VerifyMfaBody: Encodable, Sendable {
        let challengeToken: String
        let code: String
        let deviceLabel: String
    }

    func verifyMfa(
        challengeToken: String,
        code: String,
        deviceLabel: String
    ) async throws -> LoginResponse {
        var request = APIRequest.post(
            "auth/2fa/verify",
            body: VerifyMfaBody(challengeToken: challengeToken, code: code, deviceLabel: deviceLabel)
        )
        request.requiresAuth = false
        return try await client.send(request)
    }

    // MARK: - TOTP kurulumu
    //
    // `/setup` ve `/enable` challenge token'ını GÖVDEDE değil `Authorization`
    // başlığında bekler (`totp.controller.ts` → `actorOf(request)`).

    func totpSetup(challengeToken: String) async throws -> TotpSetup {
        var request = APIRequest.post("auth/2fa/setup")
        request.bearerOverride = challengeToken
        return try await client.send(request)
    }

    nonisolated private struct TotpCodeBody: Encodable, Sendable {
        let code: String
    }

    nonisolated private struct BackupCodesResponse: Decodable, Sendable {
        let backupCodes: [String]
    }

    func totpEnable(challengeToken: String, code: String) async throws -> [String] {
        var request = APIRequest.post("auth/2fa/enable", body: TotpCodeBody(code: code))
        request.bearerOverride = challengeToken
        let response: BackupCodesResponse = try await client.send(request)
        return response.backupCodes
    }

    // MARK: - Passkey

    func passkeyAssertionOptions() async throws -> PasskeyOptions {
        var request = APIRequest.post("auth/passkey/options", body: EmptyBody())
        request.requiresAuth = false
        let raw: WebAuthnOptionsPayload = try await client.send(request)
        return try raw.assertionOptions()
    }

    func passkeyVerify(
        _ assertion: PasskeyAssertion,
        deviceLabel: String
    ) async throws -> LoginResponse {
        var request = APIRequest.post(
            "auth/passkey/verify",
            body: WebAuthnEnvelope(response: assertion.credentialJSON, deviceLabel: deviceLabel)
        )
        request.requiresAuth = false
        return try await client.send(request)
    }

    func passkeyRegistrationOptions() async throws -> PasskeyOptions {
        let raw: WebAuthnOptionsPayload = try await client.send(
            APIRequest.post("auth/passkeys/register/options")
        )
        return try raw.registrationOptions()
    }

    func registerPasskey(_ registration: PasskeyRegistration, deviceLabel: String) async throws {
        try await client.send(APIRequest.post(
            "auth/passkeys/register",
            body: WebAuthnEnvelope(response: registration.credentialJSON, deviceLabel: deviceLabel)
        ))
    }

    // MARK: - Oturum sonrası

    func me() async throws -> MeResponse {
        try await client.send(APIRequest.get("me"))
    }

    func branches() async throws -> [BranchSummary] {
        let response: ListEnvelope<BranchSummary> = try await client.send(APIRequest.get("branches"))
        return response.data
    }

    // MARK: - Telefon doğrulama

    nonisolated private struct StartPhoneBody: Encodable, Sendable {
        let phone: String
    }

    func startPhoneVerification(phone: String) async throws -> PhoneVerificationStarted {
        try await client.send(APIRequest.post("auth/phone/start", body: StartPhoneBody(phone: phone)))
    }

    nonisolated private struct VerifyPhoneBody: Encodable, Sendable {
        let code: String
    }

    func verifyPhone(code: String) async throws -> PhoneVerified {
        try await client.send(APIRequest.post("auth/phone/verify", body: VerifyPhoneBody(code: code)))
    }

    // MARK: - Parola kurtarma

    nonisolated private struct ForgotPasswordBody: Encodable, Sendable {
        let email: String
    }

    func forgotPassword(email: String) async throws {
        var request = APIRequest.post("auth/password/forgot", body: ForgotPasswordBody(email: email))
        request.requiresAuth = false
        try await client.send(request)
    }

    // MARK: - Oturum

    nonisolated private struct RefreshBody: Encodable, Sendable {
        let refreshToken: String
    }

    func refresh(refreshToken: String) async throws -> AuthTokens {
        var request = APIRequest.post("auth/refresh", body: RefreshBody(refreshToken: refreshToken))
        request.requiresAuth = false
        return try await client.send(request)
    }

    func logout() async throws {
        try await client.send(APIRequest.post("auth/logout"))
    }
}

private nonisolated struct EmptyBody: Encodable, Sendable {}
