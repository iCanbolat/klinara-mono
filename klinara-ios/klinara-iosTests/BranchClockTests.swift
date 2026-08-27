import Foundation
import Testing
@testable import klinara_ios

/// ``BranchClock`` takvimin tamamının üzerinde durduğu tek soyutlama:
/// "hangi gün" sorusunun cevabı cihazın değil **şubenin** saatine göre verilir.
/// Bir gün kayması, kullanıcının bugünü açıp dünü görmesi demek.
@Suite("BranchClock")
struct BranchClockTests {

    private let istanbul = BranchClock(timeZoneIdentifier: "Europe/Istanbul")
    /// Türkiye 2016'dan beri yaz saati uygulamıyor; DST davranışını sınamak
    /// için gerçekten geçiş yapan bir dilim gerekiyor.
    private let berlin = BranchClock(timeZoneIdentifier: "Europe/Berlin")

    @Test("Bilinmeyen dilimde cihaz saatine düşülmez")
    func neverFallsBackToDevice() {
        // Cihaz saatine düşmek, kliniğin gördüğü saatle sunucudaki saatin
        // sessizce ayrışması demekti.
        #expect(BranchClock(timeZoneIdentifier: nil).timeZone.identifier == "Europe/Istanbul")
        #expect(BranchClock(timeZoneIdentifier: "Yok/Böyle").timeZone.identifier == "Europe/Istanbul")
        #expect(BranchClock(timeZoneIdentifier: "America/New_York").timeZone.identifier == "America/New_York")
    }

    @Test("Yerel tarih metni şube gününü verir")
    func localDateStringUsesBranchDay() throws {
        // 2026-09-07T21:30Z → İstanbul'da 8 Eylül 00:30, Berlin'de 7 Eylül 23:30.
        let instant = try #require(KlinaraCoding.parseTimestamp("2026-09-07T21:30:00.000Z"))
        #expect(istanbul.localDateString(instant) == "2026-09-08")
        #expect(berlin.localDateString(instant) == "2026-09-07")
    }

    @Test("Yerel tarih metni geri çözülür")
    func parsesLocalDateString() throws {
        let day = try #require(istanbul.date(fromLocalDateString: "2026-09-07"))
        #expect(istanbul.localDateString(day) == "2026-09-07")
        #expect(istanbul.minutesFromMidnight(day) == 0)
        #expect(istanbul.date(fromLocalDateString: "07.09.2026") == nil)
        #expect(istanbul.date(fromLocalDateString: "2026-09") == nil)
    }

    @Test("Hafta pazartesi başlar")
    func weekStartsOnMonday() throws {
        // 2026-09-07 bir pazartesi; 2026-09-13 aynı haftanın pazarı.
        let sunday = try #require(istanbul.date(fromLocalDateString: "2026-09-13"))
        #expect(istanbul.localDateString(istanbul.startOfWeek(sunday)) == "2026-09-07")

        let days = istanbul.weekDays(of: sunday)
        #expect(days.count == 7)
        #expect(istanbul.localDateString(days[0]) == "2026-09-07")
        #expect(istanbul.localDateString(days[6]) == "2026-09-13")
    }

    @Test("Gün ekleme ay ve yıl sınırını aşar")
    func addsDaysAcrossBoundaries() throws {
        let endOfMonth = try #require(istanbul.date(fromLocalDateString: "2026-08-31"))
        #expect(istanbul.localDateString(istanbul.adding(days: 1, to: endOfMonth)) == "2026-09-01")

        let endOfYear = try #require(istanbul.date(fromLocalDateString: "2026-12-31"))
        #expect(istanbul.localDateString(istanbul.adding(days: 1, to: endOfYear)) == "2027-01-01")
    }

    @Test("Yaz saati geçiş günü 23 saattir")
    func handlesDaylightSavingTransition() throws {
        // Berlin'de 2026-03-29 gecesi saatler 02:00'den 03:00'e alınır.
        let day = try #require(berlin.date(fromLocalDateString: "2026-03-29"))
        let next = berlin.adding(days: 1, to: day)

        #expect(berlin.localDateString(next) == "2026-03-30")
        // Gün 24 değil 23 saat sürüyor; blok konumlandırması saat bileşenine
        // değil gün başlangıcına göre ölçüldüğü için bu doğru çıkmalı.
        #expect(berlin.minutes(from: day, to: next) == 23 * 60)
    }

    @Test("Bir güne saat yerleştirmek şube saatinde yapılır")
    func placesTimeOnDay() throws {
        let day = try #require(istanbul.date(fromLocalDateString: "2026-09-07"))
        let at930 = istanbul.date(on: day, at: ClockTime(hour: 9, minute: 30))
        #expect(istanbul.minutesFromMidnight(at930) == 570)
        #expect(istanbul.formatTime(at930).contains("09:30"))
    }

    @Test("Dakika aritmetiği ve aynı gün kontrolü")
    func minuteArithmetic() throws {
        let day = try #require(istanbul.date(fromLocalDateString: "2026-09-07"))
        let start = istanbul.date(on: day, at: ClockTime(hour: 9, minute: 0))
        let end = istanbul.adding(minutes: 75, to: start)

        #expect(istanbul.minutes(from: start, to: end) == 75)
        #expect(istanbul.isSameDay(start, end))
        #expect(!istanbul.isSameDay(start, istanbul.adding(days: 1, to: start)))
    }

    @Test("Sunucuya giden değer şube offset'ini taşır")
    func wireValueCarriesBranchOffset() throws {
        let day = try #require(istanbul.date(fromLocalDateString: "2026-09-07"))
        let at1400 = istanbul.date(on: day, at: ClockTime(hour: 14, minute: 0))
        let wire = istanbul.wireValue(at1400)

        #expect(wire.hasPrefix("2026-09-07T14:00:00"))
        #expect(wire.hasSuffix("+03:00"))
        // Gidiş-dönüş aynı ana çözülmeli.
        #expect(KlinaraCoding.parseTimestamp(wire) == at1400)
    }
}
