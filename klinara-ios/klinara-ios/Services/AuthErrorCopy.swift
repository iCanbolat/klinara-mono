import Foundation

/// `packages/shared/src/error-codes.ts` enum'unun Swift yansıması.
///
/// İstemci **bu değerlere** göre dallanır; `title`/`detail` insan içindir ve
/// sunucuda serbestçe değişebilir. Bilinmeyen bir kod gelirse `.unknown`'a
/// düşer — yeni sunucu kodu eski istemciyi çökertmez.
enum APIErrorCode: String, Decodable, Sendable {
    // Genel
    case validationFailed = "VALIDATION_FAILED"
    case notFound = "NOT_FOUND"
    case internalError = "INTERNAL_ERROR"
    case rateLimited = "RATE_LIMITED"
    case serviceUnavailable = "SERVICE_UNAVAILABLE"

    // Kimlik & yetki
    case unauthenticated = "UNAUTHENTICATED"
    case tokenExpired = "TOKEN_EXPIRED"
    case tokenInvalid = "TOKEN_INVALID"
    case forbidden = "FORBIDDEN"
    case branchForbidden = "BRANCH_FORBIDDEN"

    // Giriş akışı
    case invalidCredentials = "INVALID_CREDENTIALS"
    case accountLocked = "ACCOUNT_LOCKED"
    case accountDisabled = "ACCOUNT_DISABLED"
    case tenantSelectionRequired = "TENANT_SELECTION_REQUIRED"
    case mfaRequired = "MFA_REQUIRED"
    case mfaInvalid = "MFA_INVALID"
    case phoneNotVerified = "PHONE_NOT_VERIFIED"
    case phoneInUse = "PHONE_IN_USE"
    case verificationFailed = "VERIFICATION_FAILED"
    case passkeyInvalid = "PASSKEY_INVALID"
    case credentialRequired = "CREDENTIAL_REQUIRED"
    case invitationInvalid = "INVITATION_INVALID"

    case unknown = "UNKNOWN"

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = APIErrorCode(rawValue: raw) ?? .unknown
    }
}

/// RFC 9457 `application/problem+json` gövdesi.
struct ProblemDetails: Decodable, Sendable {
    let code: APIErrorCode
    let title: String
    let detail: String?
    let status: Int
    /// Destek talebinde kullanıcının bize verebileceği iz.
    let requestId: String?
}

enum AuthError: Error, Sendable {
    /// Sunucu RFC 9457 hatası döndürdü.
    case problem(ProblemDetails)
    /// Bağlantı kurulamadı / zaman aşımı.
    case network
    /// Yanıt beklenen sözleşmeye uymuyor.
    case malformedResponse(String)
    /// Kullanıcı sistem sheet'ini kapattı — hata gösterilmez.
    case cancelled
}

// MARK: - Kullanıcıya görünen metinler

extension AuthError {

    /// Kullanıcıya gösterilecek Türkçe mesaj.
    ///
    /// İki kural burada **kasıtlı** olarak korunur:
    /// 1. Hatalı giriş mesajı telefon mu parola mı yanlış olduğunu söylemez —
    ///    aksi hâlde bu uç bir hesap numaralandırma aracına dönüşür.
    /// 2. Sunucunun `detail` metni doğrudan basılmaz; sunucu tarafı serbest
    ///    metindir ve arayüz sözleşmesi değildir.
    var displayMessage: String {
        switch self {
        case .network:
            return "Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin."

        case .cancelled:
            return ""

        case .malformedResponse:
            return "Beklenmeyen bir yanıt alındı. Lütfen tekrar deneyin."

        case .problem(let problem):
            switch problem.code {
            case .invalidCredentials, .unauthenticated:
                return "Girdiğiniz bilgiler hatalı. Lütfen kontrol edip tekrar deneyin."
            case .accountLocked:
                return "Çok fazla hatalı deneme yapıldı. Hesabınız geçici olarak kilitlendi."
            case .accountDisabled:
                return "Hesabınız devre dışı. Klinik yöneticinizle iletişime geçin."
            case .rateLimited:
                return "Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin."
            case .mfaInvalid:
                return "Kod doğrulanamadı. Yeni kodu bekleyip tekrar deneyin."
            case .verificationFailed:
                return "Kod hatalı veya süresi dolmuş. Yeni bir kod isteyin."
            case .phoneNotVerified:
                return "Bu numara henüz doğrulanmadı. Doğrulanmamış numarayla giriş yapılamaz."
            case .phoneInUse:
                return "Bu numara başka bir hesapta doğrulanmış."
            case .passkeyInvalid:
                return "Passkey doğrulanamadı. Parolanızla giriş yapmayı deneyin."
            case .credentialRequired:
                return "Son giriş yönteminiz kaldırılamaz. Önce başka bir yöntem ekleyin."
            case .forbidden:
                return "Bu işlem için yetkiniz yok."
            case .branchForbidden:
                return "Bu şube için yetkiniz yok."
            case .tokenExpired, .tokenInvalid:
                return "Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın."
            case .invitationInvalid:
                return "Davet bağlantısı geçersiz veya süresi dolmuş."
            case .serviceUnavailable:
                return "Servise şu anda ulaşılamıyor. Kısa süre sonra tekrar deneyin."
            case .validationFailed:
                return "Girdiğiniz bilgileri kontrol edin."
            default:
                return "Bir sorun oluştu. Lütfen tekrar deneyin."
            }
        }
    }

    /// Destek için gösterilecek iz. Yalnız bilinmeyen/sunucu hatalarında anlamlı.
    var supportReference: String? {
        guard case .problem(let problem) = self else { return nil }
        switch problem.code {
        case .internalError, .unknown, .serviceUnavailable:
            return problem.requestId
        default:
            return nil
        }
    }

    /// "Tekrar dene" butonu gösterilmeli mi.
    var isRetryable: Bool {
        switch self {
        case .network:
            return true
        case .problem(let problem):
            return problem.code == .internalError || problem.code == .serviceUnavailable
        case .cancelled, .malformedResponse:
            return false
        }
    }

    /// Oturumun tamamen düşürülmesi gerekiyor mu.
    var invalidatesSession: Bool {
        guard case .problem(let problem) = self else { return false }
        return problem.code == .tokenExpired || problem.code == .tokenInvalid
    }

    /// Kullanıcının iptal ettiği passkey akışı gibi, gösterilmeyecek hatalar.
    var isSilent: Bool {
        if case .cancelled = self { return true }
        return false
    }
}
