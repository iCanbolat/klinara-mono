import Foundation
import Testing
@testable import klinara_ios

/// Faz 2'de canlıya çıkınca patlayan hatanın (Ek D, #1) regresyon testi.
///
/// Faz 3 API'si **üç ayrı tarih biçimi** kullanıyor; ikisi ``KlinaraCoding``
/// tarafından çözülmeli, üçüncüsü ise `Date`'e çözülmemeli.
@Suite("Tarih çözümleme")
struct KlinaraCodingTests {

    private struct Wrapper: Decodable, Equatable {
        let at: Date
    }

    private func decode(_ raw: String) throws -> Date {
        let json = Data(#"{"at":"\#(raw)"}"#.utf8)
        return try KlinaraCoding.decoder().decode(Wrapper.self, from: json).at
    }

    @Test("Şube offset'li, kesirsiz damga çözülür")
    func parsesZonedWithoutFraction() throws {
        // Randevu, takvim ve uygunluk saatlerinin biçimi.
        let date = try decode("2026-09-07T14:00:00+03:00")
        #expect(KlinaraCoding.timestamp(date) == "2026-09-07T11:00:00.000Z")
    }

    @Test("UTC, kesirli damga çözülür")
    func parsesUTCWithFraction() throws {
        // `createdAt`, geçmiş kayıtları ve `conflicts[]` bu biçimde gelir.
        // `.iso8601` stratejisi bunu reddediyordu — hatanın kendisi buydu.
        let date = try decode("2026-08-27T09:15:00.000Z")
        #expect(KlinaraCoding.timestamp(date) == "2026-08-27T09:15:00.000Z")
    }

    @Test("İki biçim aynı anı verir")
    func bothFormatsAgree() throws {
        #expect(try decode("2026-09-07T14:00:00+03:00") == (try decode("2026-09-07T11:00:00.000Z")))
    }

    @Test("Çıplak tarih Date'e ÇÖZÜLMEZ")
    func rejectsBareLocalDate() {
        // `birthDate` ve `density[].localDay` bir an değil takvim günüdür;
        // `Date`'e çözmek onu cihaz saatiyle gece yarısına sabitlerdi. Bu
        // yüzden modellerde `String` taşınıyor ve çözücü onu kabul etmemeli.
        #expect(throws: DecodingError.self) { try decode("2026-09-07") }
    }

    @Test("Bozuk metin anlamlı hata verir")
    func failsLoudlyOnGarbage() {
        #expect(throws: DecodingError.self) { try decode("dün") }
    }

    @Test("Kodlama sunucunun ürettiği biçimi verir")
    func encodesLikeServer() throws {
        struct Body: Encodable { let at: Date }
        let date = try decode("2026-09-07T11:00:00.000Z")
        let json = try KlinaraCoding.encoder().encode(Body(at: date))
        #expect(String(decoding: json, as: UTF8.self) == #"{"at":"2026-09-07T11:00:00.000Z"}"#)
    }
}
