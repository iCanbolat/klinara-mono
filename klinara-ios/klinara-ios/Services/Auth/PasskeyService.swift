import AuthenticationServices
import LocalAuthentication
import SwiftUI

/// Cihazdaki biyometri türü — buton metnini doğru yazmak için.
enum BiometryKind {
    case faceID, touchID, opticID, none

    var displayName: String {
        switch self {
        case .faceID: "Face ID"
        case .touchID: "Touch ID"
        case .opticID: "Optic ID"
        case .none: "Passkey"
        }
    }

    var symbolName: String {
        switch self {
        case .faceID: "faceid"
        case .touchID: "touchid"
        case .opticID: "opticid"
        case .none: "person.badge.key"
        }
    }

    static var current: BiometryKind {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else {
            return .none
        }
        return switch context.biometryType {
        case .faceID: .faceID
        case .touchID: .touchID
        case .opticID: .opticID
        default: .none
        }
    }
}

/// Passkey akışlarının istemci sözleşmesi.
protocol PasskeyPerforming: Sendable {
    func assert(options: PasskeyOptions) async throws -> PasskeyAssertion
    func register(options: PasskeyOptions) async throws -> PasskeyRegistration
}

/// Bu cihazda daha önce passkey kaydedildi mi.
///
/// WebAuthn API'si "bu cihazda kayıtlı passkey var mı" sorusuna cevap vermez
/// (kasıtlı — sorgu bir izleme yüzeyi olurdu). Bu yüzden kaydı **biz**
/// işaretleriz; yalnız hangi butonun öne çıkacağını belirler, güvenlik kararı değildir.
@MainActor
enum PasskeyRegistry {
    private static let key = "klinara.passkey.enrolled"

    static var hasEnrolledPasskey: Bool {
        get { UserDefaults.standard.bool(forKey: key) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
}

// MARK: - Gerçek uygulama

/// `AuthenticationServices` sarmalayıcısı.
///
/// Çalışması için `WEBAUTHN_RP_ID` alan adının `apple-app-site-association`
/// dosyasını yayınlaması ve uygulamada `webcredentials:` associated domain
/// yetkisinin tanımlı olması gerekir. İkisi de dağıtım işidir; hazır
/// olmadan bu sınıf `PASSKEY_INVALID` benzeri hatalar döndürür.
@MainActor
final class SystemPasskeyService: NSObject, PasskeyPerforming {

    private var continuation: CheckedContinuation<ASAuthorization, Error>?

    /// Sistem sheet'inin üzerinde açılacağı pencere. İstek gönderilmeden
    /// **önce** ayarlanır; sheet penceresiz açılamayacağı için delegenin
    /// dönüş değeri bu noktadan sonra daima doludur.
    private var anchor: ASPresentationAnchor!

    /// Öndeki sahnenin penceresi.
    private static func frontWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let active = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        return active?.keyWindow ?? active?.windows.first
    }

    func assert(options: PasskeyOptions) async throws -> PasskeyAssertion {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: options.relyingPartyIdentifier
        )
        let request = provider.createCredentialAssertionRequest(challenge: options.challenge)
        let authorization = try await perform([request])

        guard let credential = authorization.credential
            as? ASAuthorizationPlatformPublicKeyCredentialAssertion
        else { throw AuthError.malformedResponse("Beklenmeyen passkey yanıtı") }

        return PasskeyAssertion(
            credentialID: credential.credentialID,
            clientDataJSON: credential.rawClientDataJSON,
            authenticatorData: credential.rawAuthenticatorData,
            signature: credential.signature,
            userHandle: credential.userID
        )
    }

    func register(options: PasskeyOptions) async throws -> PasskeyRegistration {
        guard let userID = options.userID, let userName = options.userName else {
            throw AuthError.malformedResponse("Kayıt seçeneklerinde kullanıcı bilgisi yok")
        }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: options.relyingPartyIdentifier
        )
        let request = provider.createCredentialRegistrationRequest(
            challenge: options.challenge,
            name: userName,
            userID: userID
        )
        let authorization = try await perform([request])

        guard let credential = authorization.credential
            as? ASAuthorizationPlatformPublicKeyCredentialRegistration
        else { throw AuthError.malformedResponse("Beklenmeyen passkey yanıtı") }

        return PasskeyRegistration(
            credentialID: credential.credentialID,
            clientDataJSON: credential.rawClientDataJSON,
            attestationObject: credential.rawAttestationObject ?? Data()
        )
    }

    private func perform(_ requests: [ASAuthorizationRequest]) async throws -> ASAuthorization {
        // Pencere yoksa sunacak bir yer de yoktur; isteği hiç başlatmayız.
        guard let window = Self.frontWindow() else {
            throw AuthError.malformedResponse("Passkey sheet'i için pencere bulunamadı")
        }
        anchor = window

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: requests)
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }
}

extension SystemPasskeyService: ASAuthorizationControllerDelegate {

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        continuation?.resume(returning: authorization)
        continuation = nil
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: any Error
    ) {
        // Kullanıcının sheet'i kapatması bir hata değildir; sessizce geri döneriz.
        let resolved: Error = (error as? ASAuthorizationError)?.code == .canceled
            ? AuthError.cancelled
            : AuthError.problem(ProblemDetails(
                code: .passkeyInvalid,
                title: "Passkey doğrulanamadı",
                detail: error.localizedDescription,
                status: 401,
                requestId: nil
            ))
        continuation?.resume(throwing: resolved)
        continuation = nil
    }
}

extension SystemPasskeyService: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        anchor
    }
}

// MARK: - Mock

/// Associated domain yayınlanmadan sistem sheet'i açılamaz; bu yüzden
/// arayüz geliştirmesi sırasında akış burada taklit edilir. Protokol
/// arayüzü gerçek uygulamayla aynıdır, ekranlar farkı görmez.
struct MockPasskeyService: PasskeyPerforming {

    /// Kullanıcının sheet'i iptal etmesini test etmek için.
    var simulatesCancellation = false

    func assert(options: PasskeyOptions) async throws -> PasskeyAssertion {
        try await biometricPause()
        return PasskeyAssertion(
            credentialID: Data("mock-credential".utf8),
            clientDataJSON: Data("{}".utf8),
            authenticatorData: Data(),
            signature: Data(),
            userHandle: Data("mock-user".utf8)
        )
    }

    func register(options: PasskeyOptions) async throws -> PasskeyRegistration {
        try await biometricPause()
        return PasskeyRegistration(
            credentialID: Data("mock-credential".utf8),
            clientDataJSON: Data("{}".utf8),
            attestationObject: Data()
        )
    }

    /// Face ID sheet'inin açılıp kapanma süresi kadar bekler —
    /// yükleme durumunun gerçekten görünmesi için.
    private func biometricPause() async throws {
        try? await Task.sleep(for: .seconds(0.9))
        if simulatesCancellation { throw AuthError.cancelled }
    }
}
