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

    // Takvim
    case slotConflict = "SLOT_CONFLICT"
    case resourceUnavailable = "RESOURCE_UNAVAILABLE"
    case outsideWorkingHours = "OUTSIDE_WORKING_HOURS"
    case invalidStatusTransition = "INVALID_STATUS_TRANSITION"
    case versionConflict = "VERSION_CONFLICT"
    case idempotencyConflict = "IDEMPOTENCY_CONFLICT"

    // Paket (Faz 5)
    /// Kalan hak yetersiz. Randevu tamamlanırken de gelebilir — o zaman
    /// randevu da tamamlanmamıştır, ikisi aynı transaction'da yaşar.
    case packageExhausted = "PACKAGE_EXHAUSTED"
    /// Paket süresi dolmuş ya da aktif değil; tüketim yazılamaz.
    case packageExpired = "PACKAGE_EXPIRED"

    // Finans (Faz 6)
    /// Tahsis edilen tutar kalemin bakiyesini ya da tahsilatın kendisini aşıyor.
    /// Sunucu bunu iki ayrı deferred trigger'dan üretiyor (`K0012`, `K0013`);
    /// istemci için ikisi de aynı düzeltmeyi ister: tutarı küçült.
    case paymentExceedsBalance = "PAYMENT_EXCEEDS_BALANCE"
    /// İndirim süresi dolmuş, pasif ya da kullanım hakkı tükenmiş.
    case discountInvalid = "DISCOUNT_INVALID"
    /// Nakit tahsilat ya da iade için açık bir kasa oturumu gerekir.
    case cashSessionRequired = "CASH_SESSION_REQUIRED"
    /// Şube başına yalnız bir açık kasa oturumu olabilir.
    case cashSessionAlreadyOpen = "CASH_SESSION_ALREADY_OPEN"
    /// Kapatılmış prim dönemi değiştirilemez; düzeltme cari döneme düşer.
    case periodClosed = "PERIOD_CLOSED"

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

    /// `409 SLOT_CONFLICT`'te hangi kaynağın hangi aralıkta dolu olduğu.
    ///
    /// RFC 9457 uzantı alanları **belgenin kökünde** durur ve gövde taşıma
    /// katmanında bir kez çözülür; uca özgü olmalarına rağmen burada olmalarının
    /// sebebi bu. `nil` ile `[]` aynı anlama gelir — sunucu üretemediğinde
    /// sessizce boş dizi döndürüyor.
    let conflicts: [SlotConflict]?
    /// Aynı hatada sunulan en fazla üç alternatif slot.
    let suggestions: [SlotSuggestion]?

    init(
        code: APIErrorCode,
        title: String,
        detail: String? = nil,
        status: Int,
        requestId: String? = nil,
        errors: [FieldError]? = nil,
        conflicts: [SlotConflict]? = nil,
        suggestions: [SlotSuggestion]? = nil
    ) {
        self.code = code
        self.title = title
        self.detail = detail
        self.status = status
        self.requestId = requestId
        self.errors = errors
        self.conflicts = conflicts
        self.suggestions = suggestions
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
    /// İmzalı adrese yükleme başarısız. Nesne depolaması `problem+json`
    /// konuşmuyor; elimizde yalnız HTTP durumu var.
    case uploadFailed(status: Int)
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

        case .uploadFailed(let status):
            // 403 neredeyse her zaman süresi dolmuş imza demek: kullanıcıya
            // "yetkiniz yok" demek yanlış yönlendirme olurdu.
            return status == 403
                ? "Yükleme adresinin süresi doldu. Lütfen tekrar deneyin."
                : "Dosya yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin."

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
            case .resourceUnavailable:
                // Sunucu bu kodu üç ayrı sebeple döndürüyor (yetkinsiz personel,
                // pasif hizmet/personel, personelin izinli olması) ve hangisi
                // olduğunu yalnız `detail` söylüyor. Genel bir cümle burada
                // kullanıcıyı yanlış yöne gönderirdi.
                return problem.detail ?? problem.title
            case .invalidStatusTransition:
                return problem.detail ?? problem.title
            case .idempotencyConflict:
                return "Aynı istek hâlâ işleniyor. Birkaç saniye sonra tekrar deneyin."
            case .versionConflict:
                return "Bu kayıt siz düzenlerken başkası tarafından değiştirildi. Yenileyip tekrar deneyin."
            case .packageExhausted:
                // Randevu tamamlanırken gelirse randevu da tamamlanmadı: cümle
                // bunu söylemezse kullanıcı seansın düştüğünü sanır.
                return "Paket hakkı yetersiz. İşlem tamamlanmadı; kalan hakkı kontrol edin."
            case .packageExpired:
                return "Paket kullanılabilir durumda değil. Süresi dolmuş ya da kapatılmış olabilir."
            case .paymentExceedsBalance:
                return "Tahsis edilen tutar kalemin bakiyesini aşıyor. Dağıtımı kontrol edin."
            case .discountInvalid:
                return "İndirim geçerli değil. Süresi dolmuş, pasife alınmış ya da kullanım hakkı tükenmiş olabilir."
            case .cashSessionRequired:
                // Nakit işlem kasaya bağlanmadan yazılamaz; kullanıcıya ne
                // yapması gerektiğini söylemek "işlem başarısız"tan yararlı.
                return "Nakit işlem için açık bir kasa oturumu gerekir. Önce kasayı açın."
            case .cashSessionAlreadyOpen:
                return "Bu şubede zaten açık bir kasa var. Önce mevcut kasayı kapatın."
            case .periodClosed:
                return "Bu prim dönemi kapatılmış ve değiştirilemez. Düzeltmeler cari döneme düşer."
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
        // Yükleme hatası neredeyse her zaman geçici: süresi dolmuş imza ya da
        // kopan bağlantı. Tekrar denemek yeni bir `presign` üretecek.
        case .uploadFailed:
            return true
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

    /// Çakışma ayrıntıları — yalnız `SLOT_CONFLICT` hatasında anlamlı.
    var slotConflicts: [SlotConflict] {
        guard case .problem(let problem) = self, problem.code == .slotConflict else { return [] }
        return problem.conflicts ?? []
    }

    /// Sunucunun önerdiği alternatif slotlar — yalnız `SLOT_CONFLICT`'te dolu.
    var slotSuggestions: [SlotSuggestion] {
        guard case .problem(let problem) = self, problem.code == .slotConflict else { return [] }
        return problem.suggestions ?? []
    }

    /// `PATCH`/`reschedule` başlığı eksik gönderilmiş — istemci hatası.
    ///
    /// Sunucu bunu `412` değil **`428`** ile ve `VERSION_CONFLICT` koduyla
    /// bildiriyor; koda bakıp "başkası değiştirdi" demek yanlış olurdu.
    var isPreconditionRequired: Bool {
        guard case .problem(let problem) = self else { return false }
        return problem.status == 428
    }

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
