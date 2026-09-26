import Foundation
import Testing
@testable import klinara_ios

@Suite("Uygunluk sunumu")
struct BookingAvailabilityPresentationTests {

    private let clock = BranchClock(timeZoneIdentifier: "Europe/Istanbul")

    private func slot(_ hour: Int, _ minute: Int = 0) -> AvailabilitySlot {
        let day = clock.date(fromLocalDateString: "2026-09-29") ?? Date()
        let start = clock.date(on: day, at: ClockTime(hour: hour, minute: minute))
        return AvailabilitySlot(
            startsAt: start,
            endsAt: clock.adding(minutes: 30, to: start),
            staffProfileIds: ["p1"]
        )
    }

    private func day(
        _ status: AvailabilityDay.Status,
        holiday: String? = nil,
        opens: String? = "09:00",
        closes: String? = "18:00"
    ) -> AvailabilityDay {
        AvailabilityDay(date: "2026-09-29", status: status, holidayName: holiday, opensAt: opens, closesAt: closes)
    }

    @Test("Slotlar şube saatine göre sabah / öğleden sonra / akşam gruplanır")
    func groupsByPeriod() {
        let groups = BookingAvailabilityPresentation.group(
            [slot(9), slot(11, 45), slot(12), slot(16, 45), slot(17)],
            clock: clock
        )
        #expect(groups.map(\.period) == [.morning, .afternoon, .evening])
        #expect(groups.map(\.slots.count) == [2, 2, 1])
    }

    @Test("Boş listenin nedeni gün durumundan gelir")
    func emptyNotice() {
        let holiday = BookingAvailabilityPresentation.emptyNotice(for: day(.holiday, holiday: "Bayram"))
        #expect(holiday.title == "Tatil · Bayram")
        #expect(holiday.isDayRule)

        #expect(BookingAvailabilityPresentation.emptyNotice(for: day(.closed)).title == "Şube bu gün kapalı")
        #expect(!BookingAvailabilityPresentation.emptyNotice(for: day(.beyondWindow)).suggestsNextDay)

        let full = BookingAvailabilityPresentation.emptyNotice(for: day(.open))
        #expect(full.title == "Bu gün boş saat kalmadı")
        #expect(!full.isDayRule)
        // Eski sunucu (`days` yok) → dolu kabul.
        #expect(BookingAvailabilityPresentation.emptyNotice(for: nil) == full)
    }

    @Test("Yarım gün tatil açık günde not olarak görünür")
    func openDayNote() {
        let note = BookingAvailabilityPresentation.openDayNote(
            for: day(.open, holiday: "Arife", opens: "09:00", closes: "13:00")
        )
        #expect(note == "Arife · kısaltılmış çalışma saatleri 09:00–13:00")
        #expect(BookingAvailabilityPresentation.openDayNote(for: day(.open)) == nil)
    }

    @Test("`days` alanı eksik ya da bilinmeyen durumlu yanıt çözülür")
    func decodesDays() throws {
        let legacy = """
        {"branchId":"b","timezone":"Europe/Istanbul","slotGranularityMinutes":15,"slots":[]}
        """
        let decoded = try JSONDecoder().decode(AvailabilityResponse.self, from: Data(legacy.utf8))
        #expect(decoded.days.isEmpty)

        let current = """
        {"branchId":"b","timezone":"Europe/Istanbul","slotGranularityMinutes":15,"slots":[],
         "days":[{"date":"2026-09-29","status":"beyond_window","holidayName":null,"opensAt":null,"closesAt":null},
                 {"date":"2026-09-30","status":"something_new","holidayName":null,"opensAt":null,"closesAt":null}]}
        """
        let parsed = try JSONDecoder().decode(AvailabilityResponse.self, from: Data(current.utf8))
        #expect(parsed.day("2026-09-29")?.status == .beyondWindow)
        #expect(parsed.day("2026-09-30")?.status == .unknown)
    }
}
