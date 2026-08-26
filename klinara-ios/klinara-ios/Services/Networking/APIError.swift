import Foundation

/// `packages/shared/src/error-codes.ts` enum'unun Swift yansıması.
///
/// İstemci **bu değerlere** göre dallanır; `title`/`detail` insan içindir ve
/// sunucuda serbestçe değişebilir. Bilinmeyen bir kod gelirse `.unknown`'a
/// düşer — yeni sunucu kodu eski istemciyi çökertmez.
nonisolated enum APIErrorCode: String, Decodable, Sendable {
    // Genel
    case validationFailed = "VALIDATION_FAILED"
    case notFound = "NOT_FOUND"
    case internalError = "INTERNAL_ERROR"
    case rateLimited = "RATE_LIMITED"
    case serviceUnavailable = "SERVICE_UNAVAILABLE"
    /// Tekillik çakışması — slug, e-posta, telefon zaten kullanımda.
    /// Faz 2 katalog/personel uçlarının en sık döndürdüğü hata.
    case conflict = "CONFLICT"

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
    /// Kendinden geniş yetkili bir rolü atama denemesi.
    case roleEscalation = "ROLE_ESCALATION"
    case tenantContextMissing = "TENANT_CONTEXT_MISSING"

    // Takvim (Faz 3'te kullanılacak; kod sözleşmesi şimdiden burada)
    case slotConflict = "SLOT_CONFLICT"
    case resourceUnavailable = "RESOURCE_UNAVAILABLE"
    case outsideWorkingHours = "OUTSIDE_WORKING_HOURS"
    case invalidStatusTransition = "INVALID_STATUS_TRANSITION"
    case versionConflict = "VERSION_CONFLICT"

    case unknown = "UNKNOWN"

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = APIErrorCode(rawValue: raw) ?? .unknown
    }
}

/// Alan bazlı doğrulama hatası — `VALIDATION_FAILED` yanıtlarında gelir.
///
/// `path` sunucudaki DTO alan adıdır (`durationMinutes`, `branchOverrides.0.priceMinor`).
/// Formlar hatayı bu ada göre ilgili alanın altına yerleştirir.
nonisolated struct FieldError: Decodable, Sendable, Equatable {
    let path: String
    let message: String
}

/// RFC 9457 `application/problem+json` gövdesi.
nonisolated struct ProblemDetails: Decodable, Sendable {
    let code: APIErrorCode
    let title: String
    let detail: String?
    let status: Int
    /// Destek talebinde kullanıcının bize verebileceği iz.
    let requestId: String?
    /// Yalnız doğrulama hatalarında dolu.
    let errors: [FieldError]?

    init(
        code: APIErrorCode,
        title: String,
        detail: String? = nil,
        status: Int,
        requestId: String? = nil,
        errors: [FieldError]? = nil
    ) {
        self.code = code
        self.title = title
        self.detail = detail
        self.status = status
        self.requestId = requestId
        self.errors = errors
    }
}

/// Sunucu ve taşıma katmanı hatalarının tek tipi.
///
/// Adı `AuthError` idi; Faz 2 ile katalog, personel ve takvim uçları da aynı
/// sözleşmeyi kullandığı için genelleştirildi. Alt satırdaki `typealias`
/// mevcut giriş ekranlarını kırmadan yaşatır.
nonisolated enum APIError: Error, Sendable {
    /// Sunucu RFC 9457 hatası döndürdü.
    case problem(ProblemDetails)
    /// Bağlantı kurulamadı / zaman aşımı.
    case network
    /// Yanıt beklenen sözleşmeye uymuyor.
    case malformedResponse(String)
    /// Kullanıcı sistem sheet'ini kapattı — hata gösterilmez.
    case cancelled
}

/// Giriş akışı kodunun eski adı. Yeni kodda `APIError` kullanılır.
typealias AuthError = APIError

// MARK: - Kullanıcıya görünen metinler

extension APIError {

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
            case .conflict:
                // Tek istisna: sunucunun kendi metni burada gerçekten ayırt
                // edici ("Bu hizmet kodu zaten kullanımda") ve genel bir
                // cümleden çok daha yardımcı. `AppError.conflict` mesajı
                // `title`a yazar, `detail` boş gelir — canlı uçta doğrulandı.
                return problem.detail ?? problem.title
            case .notFound:
                return "Kayıt bulunamadı. Liste güncellenmiş olabilir."
            case .roleEscalation:
                return "Kendinizden geniş yetkili bir rol atayamazsınız."
            case .slotConflict:
                return "Seçilen saat dolu. Başka bir saat seçin."
            case .outsideWorkingHours:
                return "Seçilen saat çalışma saatleri dışında."
            case .versionConflict:
                return "Bu kayıt siz düzenlerken başkası tarafından değiştirildi. Yenileyip tekrar deneyin."
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

// MARK: - Form yardımcıları

extension APIError {

    /// Alan bazlı doğrulama hataları — form alanlarının altına yerleştirilir.
    var fieldErrors: [String: String] {
        guard case .problem(let problem) = self, let errors = problem.errors else { return [:] }
        // Aynı alan için birden çok kural kırılmışsa ilki gösterilir;
        // kullanıcıya aynı anda beş cümle basmanın faydası yok.
        return errors.reduce(into: [:]) { result, item in
            if result[item.path] == nil { result[item.path] = item.message }
        }
    }

    /// Hata gövdesi tamamen alan bazlıysa banner gösterilmez — mesaj zaten
    /// alanların altında duruyor, tepede tekrar etmek gürültü olur.
    var isFieldScoped: Bool {
        guard case .problem(let problem) = self else { return false }
        return problem.code == .validationFailed && problem.errors?.isEmpty == false
    }
}
