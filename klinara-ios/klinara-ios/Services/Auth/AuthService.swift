import Foundation
import UIKit

/// Passkey doğrulama sonucu — `AuthenticationServices`'ten gelir,
/// olduğu gibi sunucuya iletilir.
struct PasskeyAssertion: Sendable {
    let credentialID: Data
    let clientDataJSON: Data
    let authenticatorData: Data
    let signature: Data
    let userHandle: Data?
}

/// Passkey kayıt sonucu.
struct PasskeyRegistration: Sendable {
    let credentialID: Data
    let clientDataJSON: Data
    let attestationObject: Data
}

/// Kimlik uçlarının istemci sözleşmesi.
///
/// Ekranlar **yalnız** bu protokole konuşur. Şu an arkasında
/// ``MockAuthService`` durur; Faz 1 uçları bağlanırken `LiveAuthService`
/// eklenir ve ekranlarda tek satır değişmez.
protocol AuthService: Sendable {

    // MARK: Giriş

    /// `POST /auth/login` — `email` ve `phone`'dan **tam olarak biri** verilir.
    func login(
        email: String?,
        phone: String?,
        password: String,
        deviceLabel: String
    ) async throws -> LoginResponse

    /// `POST /auth/tenant` — birden çok klinikte üyeyse kiracı seçimi.
    func selectTenant(challengeToken: String, tenantId: String) async throws -> LoginResponse

    /// `POST /auth/2fa/verify` — TOTP **veya** yedek kod; ayrı uç yoktur.
    func verifyMfa(challengeToken: String, code: String, deviceLabel: String) async throws -> LoginResponse

    // MARK: TOTP kurulumu (giriş akışının içinde)

    /// `POST /auth/2fa/setup` — `mfa` ara token'ıyla çağrılabilir.
    /// Kiracı 2FA'yı zorunlu kılmış ama kullanıcı henüz kurmamışsa gerekir.
    func totpSetup(challengeToken: String) async throws -> TotpSetup

    /// `POST /auth/2fa/enable` — kurulumu doğrular.
    /// Yedek kodlar **yalnız burada, bir kez** döner.
    func totpEnable(challengeToken: String, code: String) async throws -> [String]

    // MARK: Passkey

    /// `POST /auth/passkey/options` — discoverable credential; tanımlayıcı gerekmez.
    func passkeyAssertionOptions() async throws -> PasskeyOptions

    /// `POST /auth/passkey/verify`
    func passkeyVerify(_ assertion: PasskeyAssertion, deviceLabel: String) async throws -> LoginResponse

    /// `POST /auth/passkeys/register/options` — giriş yapmış kullanıcı için.
    func passkeyRegistrationOptions() async throws -> PasskeyOptions

    /// `POST /auth/passkeys/register`
    func registerPasskey(_ registration: PasskeyRegistration, deviceLabel: String) async throws

    // MARK: Oturum sonrası

    /// `GET /me`
    func me() async throws -> MeResponse

    /// `GET /branches` — `/me` yalnız `branchIds` döndürdüğü için adlar buradan.
    func branches() async throws -> [BranchSummary]

    // MARK: Telefon doğrulama

    /// `POST /auth/phone/start`
    func startPhoneVerification(phone: String) async throws -> PhoneVerificationStarted

    /// `POST /auth/phone/verify`
    func verifyPhone(code: String) async throws -> PhoneVerified

    // MARK: Parola kurtarma

    /// `POST /auth/password/forgot`
    ///
    /// Sunucu, e-posta kayıtlı olsun ya da olmasın **aynı** yanıtı verir.
    /// Arayüz bu sözleşmeyi bozmamalı — aksi hâlde uç bir hesap
    /// numaralandırma aracına dönüşür.
    func forgotPassword(email: String) async throws

    // MARK: Oturum

    /// `POST /auth/refresh`
    func refresh(refreshToken: String) async throws -> AuthTokens

    /// `POST /auth/logout`
    func logout() async throws
}

// MARK: - Cihaz etiketi

enum DeviceLabel {
    /// `GET /auth/sessions` listesinde görünecek ad.
    @MainActor
    static var current: String {
        UIDevice.current.name
    }
}

