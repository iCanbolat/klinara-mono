import Foundation
import Testing
@testable import klinara_ios

/// Hata gövdesinin çözümlenmesi ve kullanıcıya çevrilmesi.
///
/// Faz 2'de iki hata bu katmandan çıkmıştı: `CONFLICT` kodu enum'da yoktu ve
/// alan bazlı hatalar hiç çözülmüyordu. Faz 3 beş yeni kod getiriyor.
@Suite("Hata gövdesi")
struct ProblemDetailsTests {

    private func problem(_ json: String) throws -> ProblemDetails {
        try Fixtures.decode(ProblemDetails.self, from: json)
    }

    @Test("Çakışma gövdesindeki uzantı alanları çözülür")
    func decodesSlotConflictExtensions() throws {
        let error = APIError.problem(try problem(Fixtures.slotConflict))

        #expect(error.slotConflicts.count == 1)
        #expect(error.slotSuggestions.count == 1)

        let conflict = try #require(error.slotConflicts.first)
        #expect(conflict.resourceType == "staff")
        #expect(conflict.appointmentId != nil)

        // İki alan aynı gövdede FARKLI tarih biçiminde geliyor: çakışma UTC,
        // öneri şube offset'li. Tek çözücünün ikisini de kabul etmesi şart.
        #expect(KlinaraCoding.timestamp(conflict.from) == "2026-09-07T10:55:00.000Z")
        let suggestion = try #require(error.slotSuggestions.first)
        #expect(KlinaraCoding.timestamp(suggestion.startsAt) == "2026-09-07T08:30:00.000Z")
    }

    @Test("Çakışma aralığı buffer'ları da kapsar")
    func conflictRangeIncludesBuffers() throws {
        let error = APIError.problem(try problem(Fixtures.slotConflict))
        let conflict = try #require(error.slotConflicts.first)

        // 14:00–15:00 görünen randevu, 13:55–15:10 işgal ediyor: 75 dakika.
        let minutes = Int(conflict.to.timeIntervalSince(conflict.from) / 60)
        #expect(minutes == 75)
    }

    @Test("Uzantı alanları yokken çökülmez")
    func toleratesMissingExtensions() throws {
        // Sunucu bu dizileri üretemediğinde sessizce boş döndürüyor; alan hiç
        // gelmezse de aynı şekilde davranmalıyız.
        let error = APIError.problem(try problem(Fixtures.preconditionRequired))
        #expect(error.slotConflicts.isEmpty)
        #expect(error.slotSuggestions.isEmpty)
    }

    @Test("Uzantılar yalnız SLOT_CONFLICT'te okunur")
    func extensionsAreScopedToSlotConflict() {
        // Başka bir kodun gövdesine bir gün `conflicts` girerse, çakışma
        // sayfasının kendiliğinden açılmaması gerekiyor.
        let unrelated = APIError.problem(ProblemDetails(
            code: .conflict,
            title: "Başka bir çakışma",
            status: 409,
            conflicts: [SlotConflict(
                resourceType: "staff",
                resourceId: "x",
                appointmentId: nil,
                from: .distantPast,
                to: .distantFuture
            )]
        ))
        #expect(unrelated.slotConflicts.isEmpty)
    }

    @Test("428 ile 409 aynı koda sahip ama farklı anlamda")
    func distinguishes428From409() throws {
        // Sunucu eksik `If-Match` için 412 değil **428** döndürüyor ve kod yine
        // `VERSION_CONFLICT`. Yalnız koda bakıp "başkası değiştirdi" demek
        // istemcinin kendi hatasını kullanıcıya yıkmak olurdu.
        let missing = APIError.problem(try problem(Fixtures.preconditionRequired))
        #expect(missing.isPreconditionRequired)

        let stale = APIError.problem(ProblemDetails(
            code: .versionConflict,
            title: "Kayıt değişti",
            status: 409
        ))
        #expect(!stale.isPreconditionRequired)
    }

    @Test("Alan bazlı hatalar eşlenir, ilk kural kazanır")
    func mapsFieldErrors() throws {
        let error = APIError.problem(try problem(Fixtures.validationFailure))

        #expect(error.fieldErrors["phone"] == "Geçerli bir telefon numarası girin")
        #expect(error.fieldErrors["email"] == "email must be an email")
        #expect(error.fieldErrors.count == 2)
        // Hepsi alan bazlıysa üstteki hata bandı gösterilmez.
        #expect(error.isFieldScoped)
    }

    @Test("Bilinmeyen kod .unknown'a düşer, çözümleme kırılmaz")
    func toleratesUnknownCodes() throws {
        let details = try problem(Fixtures.unknownCode)
        #expect(details.code == .unknown)
        #expect(details.status == 409)
        // Bilinmeyen kodda destek referansı gösterilir.
        #expect(APIError.problem(details).supportReference == details.requestId)
    }

    @Test("Faz 3 kodlarının hepsi kendi mesajını üretir")
    func coversEveryPhase3Code() {
        // Genel "Bir sorun oluştu" mesajı, kullanıcıya ne yapacağını
        // söylemiyor. Yeni bir kodun sessizce oraya düşmesi bu testle kırılır.
        let generic = "Bir sorun oluştu. Lütfen tekrar deneyin."
        let codes: [APIErrorCode] = [
            .slotConflict, .outsideWorkingHours, .resourceUnavailable,
            .invalidStatusTransition, .versionConflict, .idempotencyConflict,
        ]

        for code in codes {
            let error = APIError.problem(ProblemDetails(
                code: code,
                title: "Sunucu başlığı",
                detail: "Sunucu ayrıntısı",
                status: 409
            ))
            #expect(error.displayMessage != generic, "\(code.rawValue) genel mesaja düşüyor")
            #expect(!error.displayMessage.isEmpty)
        }
    }

    @Test("Oturum yalnız token hatalarında düşürülür")
    func invalidatesSessionOnlyForTokens() {
        func error(_ code: APIErrorCode) -> APIError {
            .problem(ProblemDetails(code: code, title: "x", status: 401))
        }
        #expect(error(.tokenExpired).invalidatesSession)
        #expect(error(.tokenInvalid).invalidatesSession)
        // Randevu hataları oturumu düşürmemeli.
        #expect(!error(.slotConflict).invalidatesSession)
        #expect(!error(.forbidden).invalidatesSession)
    }
}
