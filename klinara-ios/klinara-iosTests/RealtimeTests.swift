import Foundation
import Testing
@testable import klinara_ios

/// Anlık olay soketinin istemci sözleşmesi: çerçeveler içeriksiz, bilinmeyen
/// türler yok sayılır ve takvim yalnız ekranda açık olan gün etkilendiyse
/// yeniden okunur.
@MainActor
@Suite("Realtime")
struct RealtimeTests {

    @Test("Takvim çerçevesi şube ve günleri taşır")
    func decodesCalendarFrame() {
        let frame = RealtimeFrame.decode(
            #"{"type":"calendar_changed","branchId":"b1","days":["2026-09-07","2026-09-08"]}"#
        )
        #expect(frame == .event(.calendarChanged(branchId: "b1", days: ["2026-09-07", "2026-09-08"])))
    }

    @Test("Hazır, resync ve bildirim çerçeveleri")
    func decodesControlFrames() {
        #expect(RealtimeFrame.decode(#"{"type":"ready"}"#) == .ready)
        #expect(RealtimeFrame.decode(#"{"type":"resync"}"#) == .event(.resync))
        #expect(
            RealtimeFrame.decode(#"{"type":"staff_notification","kind":"inbound_message"}"#)
                == .event(.staffNotification(kind: "inbound_message"))
        )
    }

    @Test("Bilinmeyen ya da eksik çerçeve yok sayılır")
    func ignoresUnknownFrames() {
        // Sunucu yeni bir tür eklediğinde eski sürüm bozulmamalı.
        #expect(RealtimeFrame.decode(#"{"type":"something_new"}"#) == nil)
        #expect(RealtimeFrame.decode(#"{"type":"calendar_changed","branchId":"b1"}"#) == nil)
        #expect(RealtimeFrame.decode("bozuk") == nil)
    }

    @Test("Soket adresi API kökünden türetilir")
    func socketURL() throws {
        let https = try #require(URL(string: "https://api.klinara.app/api/v1"))
        #expect(LiveRealtimeService.socketURL(for: https).absoluteString == "wss://api.klinara.app/api/v1/realtime")
        let http = try #require(URL(string: "http://localhost:3000/api/v1"))
        #expect(LiveRealtimeService.socketURL(for: http).absoluteString == "ws://localhost:3000/api/v1/realtime")
    }

    @Test("Takvim yalnız açık olan gün etkilendiyse tazelenir")
    func coversVisibleDays() async throws {
        let graph = MockGraph()
        let clock = BranchClock(timeZoneIdentifier: "Europe/Istanbul")
        let monday = try #require(clock.date(fromLocalDateString: "2026-09-07"))
        let store = CalendarStore(
            service: graph.booking,
            catalog: CatalogStore(service: graph.catalog),
            today: monday
        )

        store.mode = .agenda
        #expect(store.covers(days: ["2026-09-07"], clock: clock))
        #expect(!store.covers(days: ["2026-09-08"], clock: clock))

        // Hafta görünümü haftanın yedi gününü kapsar.
        store.mode = .week
        let weekDays = clock.weekDays(of: monday).map(clock.localDateString)
        #expect(store.covers(days: [weekDays[6]], clock: clock))
        #expect(!store.covers(days: ["2026-10-01"], clock: clock))
    }

    @Test("Push rotası yalnız kimlik okur")
    func pushRoute() {
        #expect(PushRoute(userInfo: ["appointmentId": "a1", "kind": "appointment_created"]) == .appointment(id: "a1"))
        #expect(PushRoute(userInfo: ["kind": "inbound_message", "conversationId": "c1"]) == .home)
    }
}
