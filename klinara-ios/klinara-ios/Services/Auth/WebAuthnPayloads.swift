import Foundation

// WebAuthn'ın tel biçimi base64url'dür ve `AuthenticationServices` ham `Data`
// ile çalışır. Dönüşüm YALNIZ bu dosyada olur; ekranlar ve `PasskeyService`
// kodlamadan haberdar değildir.

extension Data {
    /// RFC 4648 §5 — dolgusuz base64url.
    var base64URLEncoded: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init?(base64URLEncoded string: String) {
        var padded = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        // Base64 çözücü 4'ün katı uzunluk ister; dolguyu geri koyuyoruz.
        let remainder = padded.count % 4
        if remainder > 0 { padded += String(repeating: "=", count: 4 - remainder) }
        self.init(base64Encoded: padded)
    }
}

// MARK: - Sunucudan gelen seçenekler

/// `@simplewebauthn/server`'ın ürettiği seçenek gövdesi.
///
/// Kayıt ve doğrulama akışları farklı alanlar döndürür (`rp.id` vs `rpId`);
/// tek bir esnek tip ikisini de karşılar ve eksik alanı hata olarak bildirir.
nonisolated struct WebAuthnOptionsPayload: Decodable, Sendable {

    struct RelyingParty: Decodable, Sendable {
        let id: String?
        let name: String?
    }

    struct User: Decodable, Sendable {
        let id: String
        let name: String
        let displayName: String?
    }

    let challenge: String
    let rp: RelyingParty?
    let rpId: String?
    let user: User?

    /// Kayıt akışı: `rp.id` + `user`.
    func registrationOptions() throws -> PasskeyOptions {
        guard let challengeData = Data(base64URLEncoded: challenge) else {
            throw APIError.malformedResponse("WebAuthn challenge çözülemedi")
        }
        guard let relyingParty = rp?.id ?? rpId else {
            throw APIError.malformedResponse("WebAuthn seçeneklerinde rpId yok")
        }
        guard let user, let userIDData = Data(base64URLEncoded: user.id) else {
            throw APIError.malformedResponse("WebAuthn kayıt seçeneklerinde kullanıcı yok")
        }
        return PasskeyOptions(
            challenge: challengeData,
            relyingPartyIdentifier: relyingParty,
            userID: userIDData,
            userName: user.name
        )
    }

    /// Doğrulama akışı: `rpId`, kullanıcı yok (discoverable credential).
    func assertionOptions() throws -> PasskeyOptions {
        guard let challengeData = Data(base64URLEncoded: challenge) else {
            throw APIError.malformedResponse("WebAuthn challenge çözülemedi")
        }
        guard let relyingParty = rpId ?? rp?.id else {
            throw APIError.malformedResponse("WebAuthn seçeneklerinde rpId yok")
        }
        return PasskeyOptions(
            challenge: challengeData,
            relyingPartyIdentifier: relyingParty,
            userID: nil,
            userName: nil
        )
    }
}

// MARK: - Sunucuya giden kimlik bilgisi

/// W3C `PublicKeyCredential` JSON'ı.
///
/// Kayıt ve doğrulama yanıtlarının alanları farklıdır; `nil` opsiyoneller
/// `JSONEncoder` tarafından **atlanır**, dolayısıyla tek tip ikisini de üretir.
nonisolated struct WebAuthnCredentialJSON: Encodable, Sendable {

    struct AuthenticatorResponse: Encodable, Sendable {
        let clientDataJSON: String
        var attestationObject: String?
        var authenticatorData: String?
        var signature: String?
        var userHandle: String?
    }

    let id: String
    let rawId: String
    let type = "public-key"
    let response: AuthenticatorResponse
    let clientExtensionResults: [String: String] = [:]
}

/// `RegisterPasskeyDto` / `VerifyPasskeyDto` gövdesi.
nonisolated struct WebAuthnEnvelope: Encodable, Sendable {
    let response: WebAuthnCredentialJSON
    let deviceLabel: String
}

extension PasskeyRegistration {
    var credentialJSON: WebAuthnCredentialJSON {
        WebAuthnCredentialJSON(
            id: credentialID.base64URLEncoded,
            rawId: credentialID.base64URLEncoded,
            response: .init(
                clientDataJSON: clientDataJSON.base64URLEncoded,
                attestationObject: attestationObject.base64URLEncoded
            )
        )
    }
}

extension PasskeyAssertion {
    var credentialJSON: WebAuthnCredentialJSON {
        WebAuthnCredentialJSON(
            id: credentialID.base64URLEncoded,
            rawId: credentialID.base64URLEncoded,
            response: .init(
                clientDataJSON: clientDataJSON.base64URLEncoded,
                authenticatorData: authenticatorData.base64URLEncoded,
                signature: signature.base64URLEncoded,
                userHandle: userHandle?.base64URLEncoded
            )
        )
    }
}
