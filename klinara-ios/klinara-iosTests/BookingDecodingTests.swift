import Foundation
import Testing
@testable import klinara_ios

/// Faz 3 sözleşmesinin istemci tarafındaki kanıtı.
///
/// Modeller sunucu DTO'sundan birebir türetiliyor ve `CodingKeys` eşlemesi
/// yok; bir alan adı yanlış yazıldığında derleyici susar, yalnız çalışma
/// zamanı konuşur. Bu testler o boşluğu kapatıyor.
@Suite("Randevu çözümleme")
struct BookingDecodingTests {

    @Test("Randevu detayı çözülür")
    func decodesAppointment() throws {
        let appointment = try Fixtures.decode(Appointment.self, from: Fixtures.appointment)

        #expect(appointment.status == .scheduled)
        #expect(appointment.origin == .internal)
        #expect(appointment.version == 1)
        #expect(appointment.totalMinor == 150_000)
        #expect(appointment.notes == nil)
        #expect(appointment.cancellationReason == nil)
        #expect(appointment.services.count == 1)

        // Görünen aralık şube offset'li, `createdAt` UTC. İki farklı biçim,
        // tek çözücü.
        #expect(KlinaraCoding.timestamp(appointment.startsAt) == "2026-09-07T11:00:00.000Z")
        #expect(KlinaraCoding.timestamp(appointment.createdAt) == "2026-08-27T09:15:00.000Z")
    }

    @Test("Kalem buffer'ları işgal süresine katılır")
    func computesOccupiedMinutes() throws {
        let appointment = try Fixtures.decode(Appointment.self, from: Fixtures.appointment)
        let line = try #require(appointment.services.first)

        // Müşteri 60 dakika görür; takvim 5 + 60 + 10 = 75 dakika tutar.
        #expect(line.durationMinutes == 60)
        #expect(line.occupiedMinutes == 75)
    }

    @Test("Liste ucu farklı şema döndürür ve çözülür")
    func decodesCalendarEntryPage() throws {
        let page = try Fixtures.decode(Page<CalendarEntry>.self, from: Fixtures.appointmentPage)

        #expect(page.data.count == 2)
        #expect(page.pageInfo.hasMore == false)
        #expect(page.pageInfo.nextCursor == nil)

        let first = page.data[0]
        #expect(first.status == .inProgress)          // "in_progress" → camelCase enum
        #expect(first.customerName == "Ayşe Yılmaz")
        #expect(first.customerPhone == "+905321112233")
        #expect(first.serviceSummary == "Tüm Vücut Lazer")
        #expect(first.staffProfileIds == ["77777777-0000-4000-8000-000000000001"])

        // Telefonu ve hizmet kalemi olmayan satır da çözülmeli.
        let second = page.data[1]
        #expect(second.customerPhone == nil)
        #expect(second.status == .cancelled)
        #expect(second.status.isTerminal)
        #expect(second.services.isEmpty)
        #expect(second.serviceSummary.isEmpty)
    }

    @Test("Takvim yanıtı ve yoğunluk verisi çözülür")
    func decodesCalendarResponse() throws {
        let calendar = try Fixtures.decode(CalendarResponse.self, from: Fixtures.calendarDay)

        #expect(calendar.timezone == "Europe/Istanbul")
        #expect(calendar.appointments.isEmpty)
        #expect(calendar.density.count == 2)
        // `localDay` çıplak tarihtir; `Date`'e çözülmez.
        #expect(calendar.density[0].localDay == "2026-09-07")
        #expect(calendar.density[0].localHour == 14)
        #expect(calendar.density[0].appointmentCount == 3)
    }

    @Test("Uygunluk slotları ve aday kümesi çözülür")
    func decodesAvailability() throws {
        let response = try Fixtures.decode(AvailabilityResponse.self, from: Fixtures.availability)

        #expect(response.slotGranularityMinutes == 15)
        #expect(response.slots.count == 2)
        #expect(response.slots[0].staffProfileIds.count == 2)

        // Personel filtresi uygulanınca yalnız o adayın slotları kalmalı.
        let second = "77777777-0000-4000-8000-000000000002"
        #expect(response.slots[0].supports(staffProfileId: second))
        #expect(!response.slots[1].supports(staffProfileId: second))
        #expect(response.slots[1].supports(staffProfileId: nil))
    }

    @Test("Geçmiş kaydı tüm null alanlarıyla çözülür")
    func decodesHistory() throws {
        let entries = try Fixtures.decode(
            ListEnvelope<AppointmentHistoryEntry>.self,
            from: Fixtures.history
        ).data

        #expect(entries.count == 3)
        #expect(entries[0].action == .created)
        #expect(entries[0].fromStatus == nil)
        #expect(entries[0].toStatus == .scheduled)

        // Silinen kullanıcıda `actorUserId` null gelir.
        #expect(entries[1].action == .rescheduled)
        #expect(entries[1].actorUserId == nil)
        #expect(entries[1].oldStartsAt != nil)
        #expect(entries[1].reason == "Müşteri talebi")

        #expect(entries[2].action == .statusChanged)
        #expect(entries[2].fromStatus == .scheduled)
        #expect(entries[2].toStatus == .confirmed)
    }

    @Test("Müşteri listesi ve null alanları çözülür")
    func decodesCustomers() throws {
        let customers = try Fixtures.decode(
            ListEnvelope<Customer>.self,
            from: Fixtures.customerList
        ).data

        #expect(customers.count == 2)
        #expect(customers[0].gender == .female)
        // Doğum tarihi çıplak metin olarak taşınır.
        #expect(customers[0].birthDate == "1990-05-12")
        #expect(customers[1].email == nil)
        #expect(customers[1].gender == nil)
        #expect(customers[1].birthDate == nil)
    }

    @Test("Müşteri araması ad, e-posta ve telefon üzerinden çalışır")
    func searchesCustomers() throws {
        let customers = try Fixtures.decode(
            ListEnvelope<Customer>.self,
            from: Fixtures.customerList
        ).data
        let ayse = customers[0]

        #expect(ayse.matches("ayşe"))
        // Türkçe tuzağı: `"YILMAZ".lowercased()` noktalı ı verir,
        // `"Yılmaz".lowercased()` noktasız. Aksan duyarsız karşılaştırma şart.
        #expect(ayse.matches("YILMAZ"))
        #expect(ayse.matches("yilmaz"))
        // Türkçe klavyesi olmayan kullanıcı da kendi müşterisini bulabilmeli.
        #expect(ayse.matches("ayse"))
        #expect(ayse.matches("ornek.test"))
        // Kullanıcı numarayı biçimli yazsa da rakamlar eşleşmeli.
        #expect(ayse.matches("532 111"))
        #expect(ayse.matches(""))
        #expect(!ayse.matches("mehmet"))
    }
}

@Suite("Randevu durumu")
struct AppointmentStatusTests {

    @Test("Wire değerleri sunucudaki listeyle aynı")
    func matchesServerRawValues() {
        #expect(AppointmentStatus.inProgress.rawValue == "in_progress")
        #expect(AppointmentStatus.noShow.rawValue == "no_show")
        #expect(AppointmentStatus.allCases.count == 7)
    }

    @Test("Geçiş tablosu sunucudakinin aynısı")
    func mirrorsServerTransitionTable() {
        // `0018_phase3_appointments.sql` içindeki izinli geçişler.
        #expect(AppointmentStatus.scheduled.allowedTransitions(canReopen: false)
            == [.confirmed, .arrived, .noShow, .cancelled])
        #expect(AppointmentStatus.confirmed.allowedTransitions(canReopen: false)
            == [.arrived, .noShow, .cancelled])
        #expect(AppointmentStatus.arrived.allowedTransitions(canReopen: false)
            == [.inProgress, .noShow, .cancelled])
        #expect(AppointmentStatus.inProgress.allowedTransitions(canReopen: false)
            == [.completed, .cancelled])
    }

    @Test("Sonlanmış durumlardan çıkış yok")
    func terminalStatesAreClosed() {
        #expect(AppointmentStatus.noShow.allowedTransitions(canReopen: true).isEmpty)
        #expect(AppointmentStatus.cancelled.allowedTransitions(canReopen: true).isEmpty)
        #expect(AppointmentStatus.noShow.isTerminal)
        #expect(AppointmentStatus.cancelled.isTerminal)
        // `completed` sonlanmış DEĞİL: yetkiyle geri açılabiliyor ve slotu
        // işgal etmeye devam ediyor.
        #expect(!AppointmentStatus.completed.isTerminal)
    }

    @Test("completed'dan çıkış reopen iznine bağlı")
    func reopenIsGated() {
        #expect(AppointmentStatus.completed.allowedTransitions(canReopen: false).isEmpty)
        #expect(AppointmentStatus.completed.allowedTransitions(canReopen: true)
            == [.inProgress, .cancelled])
    }

    @Test("Erteleme completed'ı da reddeder")
    func rescheduleRejectsCompleted() {
        // `completed → in_progress` meşru bir durum geçişi ama erteleme yine
        // de reddediliyor; ikisini tek kurala indirmek yanlış olurdu.
        #expect(!AppointmentStatus.completed.canReschedule)
        #expect(!AppointmentStatus.cancelled.canReschedule)
        #expect(!AppointmentStatus.noShow.canReschedule)
        #expect(AppointmentStatus.scheduled.canReschedule)
        #expect(AppointmentStatus.arrived.canReschedule)
    }

    @Test("Her durumun Türkçe adı ve rozet tonu var")
    func hasPresentationForEveryCase() {
        for status in AppointmentStatus.allCases {
            #expect(!status.turkishName.isEmpty)
            _ = status.badgeTone
        }
    }
}
