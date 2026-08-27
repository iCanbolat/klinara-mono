import Foundation
import Testing
@testable import klinara_ios

/// Mock'un sunucuya sadakati.
///
/// Store testleri bu mock'un üzerinde duruyor; önce mock'un doğru kural
/// uyguladığını bilmek gerek. Faz 2'nin dersi buydu: sunucudan farklı davranan
/// bir mock, mock'ta geçen akışın canlıda kırılması demek.
@Suite("MockBookingService")
struct MockBookingServiceTests {

    @Test("Randevu oluşturulur ve fiyat kalemden gelir")
    func createsAppointment() async throws {
        let graph = MockGraph()
        let created = try await graph.booking.create(
            graph.createInput(at: graph.workingTuesday()),
            idempotencyKey: UUID().uuidString
        )

        #expect(created.status == .scheduled)
        #expect(created.version == 1)
        #expect(created.services.count == 1)
        // Bölgesel lazer: 30 dk, 900,00 ₺.
        #expect(created.services[0].durationMinutes == 30)
        #expect(created.totalMinor == 90_000)
        #expect(graph.clock.minutes(from: created.startsAt, to: created.endsAt) == 30)
    }

    @Test("Çok hizmetli randevu sırayla zincirlenir")
    func chainsMultipleServices() async throws {
        let graph = MockGraph()
        let created = try await graph.booking.create(
            graph.createInput(
                at: graph.workingTuesday(hour: 11),
                serviceIds: [
                    MockCatalogSeed.serviceLazerBolgesel,   // 30 dk, 5 önce / 10 sonra
                    MockCatalogSeed.serviceHydrafacial,     // 60 dk, 5 önce / 10 sonra
                ]
            ),
            idempotencyKey: UUID().uuidString
        )

        #expect(created.services.count == 2)
        #expect(created.services[0].sortOrder == 0)
        #expect(created.services[1].sortOrder == 1)
        // İkinci hizmet, birincinin temizlik payı + kendi hazırlık payından sonra başlar.
        #expect(graph.clock.minutes(from: created.services[0].endsAt, to: created.services[1].startsAt) == 15)
        #expect(created.totalMinor == 90_000 + 180_000)
    }

    @Test("Aynı personele çakışan randevu SLOT_CONFLICT verir")
    func rejectsOverlap() async throws {
        let graph = MockGraph()
        let start = graph.workingTuesday(hour: 11)
        _ = try await graph.booking.create(
            graph.createInput(at: start),
            idempotencyKey: UUID().uuidString
        )

        await #expect(throws: APIError.self) {
            try await graph.booking.create(
                graph.createInput(at: start),
                idempotencyKey: UUID().uuidString
            )
        }

        do {
            _ = try await graph.booking.create(
                graph.createInput(at: start),
                idempotencyKey: UUID().uuidString
            )
        } catch let error as APIError {
            #expect(error.code == .slotConflict)
            #expect(!error.slotConflicts.isEmpty)
            // Öneriler tıklanabilir olmalı; boş liste kullanıcıyı çıkmaza sokar.
            #expect(!error.slotSuggestions.isEmpty)
            #expect(error.slotSuggestions.count <= 3)
        }
    }

    @Test("Sırt sırta randevular çakışmaz, buffer kesişmesi çakışır")
    func respectsBufferBoundaries() async throws {
        let graph = MockGraph()
        // Bölgesel lazer: 5 dk hazırlık + 30 dk işlem + 10 dk temizlik = 45 dk işgal.
        let first = graph.workingTuesday(hour: 11)
        _ = try await graph.booking.create(
            graph.createInput(at: first),
            idempotencyKey: UUID().uuidString
        )

        // 40 dakika sonrası: işgal aralıkları kesişiyor (11:45'te bitiyor).
        await #expect(throws: APIError.self) {
            try await graph.booking.create(
                graph.createInput(at: graph.clock.adding(minutes: 40, to: first)),
                idempotencyKey: UUID().uuidString
            )
        }

        // 45 dakika sonrası: tam sırt sırta, yarı açık aralıkta çakışma yok.
        let second = try await graph.booking.create(
            graph.createInput(at: graph.clock.adding(minutes: 45, to: first)),
            idempotencyKey: UUID().uuidString
        )
        #expect(second.status == .scheduled)
    }

    @Test("Yetkin olmayan personele randevu açılamaz")
    func rejectsIncompetentStaff() async throws {
        let graph = MockGraph()
        // Mehmet yalnız Bağdat şubesinde epilasyon yapıyor; Nişantaşı'nda
        // hydrafacial yetkinliği yok.
        do {
            _ = try await graph.booking.create(
                graph.createInput(
                    at: graph.workingTuesday(),
                    serviceIds: [MockCatalogSeed.serviceHydrafacial],
                    staffProfileId: MockStaffSeed.profileMehmet
                ),
                idempotencyKey: UUID().uuidString
            )
            Issue.record("Yetkinsiz personele randevu açıldı")
        } catch let error as APIError {
            #expect(error.code == .resourceUnavailable)
        }
    }

    @Test("Pasif hizmete randevu açılamaz")
    func rejectsInactiveService() async throws {
        let graph = MockGraph()
        do {
            _ = try await graph.booking.create(
                graph.createInput(
                    at: graph.workingTuesday(),
                    serviceIds: [MockCatalogSeed.serviceDolgu]  // isActive: false
                ),
                idempotencyKey: UUID().uuidString
            )
            Issue.record("Pasif hizmete randevu açıldı")
        } catch let error as APIError {
            #expect(error.code == .notFound)
        }
    }

    @Test("Aynı anahtar aynı gövdeyle tek randevu üretir")
    func replaysIdempotentRequest() async throws {
        let graph = MockGraph()
        let key = UUID().uuidString
        let input = graph.createInput(at: graph.workingTuesday())

        let first = try await graph.booking.create(input, idempotencyKey: key)
        let second = try await graph.booking.create(input, idempotencyKey: key)

        #expect(first.id == second.id)
        // Yalnız bir kayıt yazılmış olmalı; ikinci istek çakışma da vermemeli.
        let page = try await graph.booking.appointments(AppointmentListQuery(
            branchId: MockGraph.branchId,
            from: graph.clock.adding(days: -1, to: graph.workingTuesday()),
            to: graph.clock.adding(days: 1, to: graph.workingTuesday())
        ))
        #expect(page.data.count == 1)
    }

    @Test("Aynı anahtar farklı gövdeyle IDEMPOTENCY_CONFLICT verir")
    func rejectsIdempotencyKeyReuse() async throws {
        let graph = MockGraph()
        let key = UUID().uuidString
        _ = try await graph.booking.create(
            graph.createInput(at: graph.workingTuesday(hour: 11)),
            idempotencyKey: key
        )

        do {
            _ = try await graph.booking.create(
                graph.createInput(at: graph.workingTuesday(hour: 15)),
                idempotencyKey: key
            )
            Issue.record("Farklı gövde aynı anahtarla kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .idempotencyConflict)
        }
    }

    @Test("Durum makinesi zorlanır")
    func enforcesStatusMachine() async throws {
        let graph = MockGraph()
        let created = try await graph.booking.create(
            graph.createInput(at: graph.workingTuesday()),
            idempotencyKey: UUID().uuidString
        )

        // scheduled → in_progress atlanamaz.
        do {
            _ = try await graph.booking.changeStatus(
                id: created.id,
                ChangeAppointmentStatusInput(status: .inProgress)
            )
            Issue.record("Geçersiz durum geçişi kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .invalidStatusTransition)
        }

        // Zincir sırayla ilerlemeli ve her adımda sürüm artmalı.
        var current = created
        for status in [AppointmentStatus.confirmed, .arrived, .inProgress, .completed] {
            current = try await graph.booking.changeStatus(
                id: current.id,
                ChangeAppointmentStatusInput(status: status)
            )
            #expect(current.status == status)
        }
        #expect(current.version == created.version + 4)
    }

    @Test("Aynı duruma geçiş sürüm artırmayan no-op")
    func sameStatusIsNoOp() async throws {
        let graph = MockGraph()
        let created = try await graph.booking.create(
            graph.createInput(at: graph.workingTuesday()),
            idempotencyKey: UUID().uuidString
        )
        let again = try await graph.booking.changeStatus(
            id: created.id,
            ChangeAppointmentStatusInput(status: .scheduled)
        )
        #expect(again.version == created.version)
    }

    @Test("completed'dan çıkış reopen izni ister")
    func gatesReopen() async throws {
        let graph = MockGraph(canReopen: false)
        var current = try await graph.booking.create(
            graph.createInput(at: graph.workingTuesday()),
            idempotencyKey: UUID().uuidString
        )
        for status in [AppointmentStatus.confirmed, .arrived, .inProgress, .completed] {
            current = try await graph.booking.changeStatus(
                id: current.id,
                ChangeAppointmentStatusInput(status: status)
            )
        }

        do {
            _ = try await graph.booking.changeStatus(
                id: current.id,
                ChangeAppointmentStatusInput(status: .inProgress)
            )
            Issue.record("İzinsiz reopen kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .forbidden)
        }
    }

    @Test("İptal slotu serbest bırakır, kayıt silinmez")
    func cancellationFreesSlot() async throws {
        let graph = MockGraph()
        let start = graph.workingTuesday(hour: 11)
        let created = try await graph.booking.create(
            graph.createInput(at: start),
            idempotencyKey: UUID().uuidString
        )

        let cancelled = try await graph.booking.cancel(id: created.id, reason: "Müşteri erteledi")
        #expect(cancelled.status == .cancelled)
        #expect(cancelled.cancellationReason == "Müşteri erteledi")

        // Aynı slota yeniden yazılabilmeli.
        let replacement = try await graph.booking.create(
            graph.createInput(at: start),
            idempotencyKey: UUID().uuidString
        )
        #expect(replacement.status == .scheduled)

        // İptal edilen kayıt listeden kaybolmaz — denetim izi korunur.
        let page = try await graph.booking.appointments(AppointmentListQuery(
            branchId: MockGraph.branchId,
            from: graph.clock.adding(days: -1, to: start),
            to: graph.clock.adding(days: 1, to: start)
        ))
        #expect(page.data.count == 2)
        #expect(page.data.contains { $0.status == .cancelled })
    }

    @Test("Bayat sürümle güncelleme VERSION_CONFLICT verir")
    func rejectsStaleVersion() async throws {
        let graph = MockGraph()
        let created = try await graph.booking.create(
            graph.createInput(at: graph.workingTuesday()),
            idempotencyKey: UUID().uuidString
        )
        _ = try await graph.booking.updateNotes(id: created.id, version: 1, notes: "İlk not")

        do {
            _ = try await graph.booking.updateNotes(id: created.id, version: 1, notes: "İkinci not")
            Issue.record("Bayat sürüm kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .versionConflict)
        }
    }

    @Test("Not nil gönderildiğinde silinir")
    func clearsNotesOnNil() async throws {
        let graph = MockGraph()
        let created = try await graph.booking.create(
            graph.createInput(at: graph.workingTuesday(), notes: "İlk not"),
            idempotencyKey: UUID().uuidString
        )
        #expect(created.notes == "İlk not")

        let cleared = try await graph.booking.updateNotes(
            id: created.id,
            version: created.version,
            notes: nil
        )
        #expect(cleared.notes == nil)
    }

    @Test("Erteleme eski slotu bırakır, yeni slota taşır")
    func rescheduleMovesAppointment() async throws {
        let graph = MockGraph()
        let start = graph.workingTuesday(hour: 11)
        let created = try await graph.booking.create(
            graph.createInput(at: start),
            idempotencyKey: UUID().uuidString
        )

        let moved = try await graph.booking.reschedule(
            id: created.id,
            version: created.version,
            RescheduleAppointmentInput(startsAt: graph.clock.wireValue(
                graph.workingTuesday(hour: 15)
            ), reason: "Müşteri talebi")
        )
        #expect(graph.clock.minutesFromMidnight(moved.startsAt) == 15 * 60)
        #expect(moved.version == created.version + 1)

        // Eski slot artık boş: kendi yerini bloke etmemeli.
        let replacement = try await graph.booking.create(
            graph.createInput(at: start),
            idempotencyKey: UUID().uuidString
        )
        #expect(replacement.status == .scheduled)
    }

    @Test("İptal edilen randevu ertelenemez")
    func rescheduleRejectsTerminalStates() async throws {
        let graph = MockGraph()
        let created = try await graph.booking.create(
            graph.createInput(at: graph.workingTuesday()),
            idempotencyKey: UUID().uuidString
        )
        let cancelled = try await graph.booking.cancel(id: created.id, reason: nil)

        do {
            _ = try await graph.booking.reschedule(
                id: cancelled.id,
                version: cancelled.version,
                RescheduleAppointmentInput(startsAt: graph.clock.wireValue(
                    graph.workingTuesday(hour: 15)
                ))
            )
            Issue.record("İptal edilen randevu ertelendi")
        } catch let error as APIError {
            #expect(error.code == .invalidStatusTransition)
        }
    }

    @Test("Geçmiş her olayı kaydeder")
    func recordsHistory() async throws {
        let graph = MockGraph()
        let created = try await graph.booking.create(
            graph.createInput(at: graph.workingTuesday()),
            idempotencyKey: UUID().uuidString
        )
        let confirmed = try await graph.booking.changeStatus(
            id: created.id,
            ChangeAppointmentStatusInput(status: .confirmed)
        )
        _ = try await graph.booking.cancel(id: confirmed.id, reason: "Vazgeçti")

        // Sunucu en yeni olayı başta döndürüyor (`order by created_at desc`);
        // mock aynı sırayı vermeli, yoksa zaman çizelgesi canlıda ters döner.
        let history = try await graph.booking.history(id: created.id)
        #expect(history.map(\.action) == [.cancelled, .statusChanged, .created])
        #expect(history.first?.reason == "Vazgeçti")
    }

    @Test("Uygunluk çalışma saatlerini ve molayı uygular")
    func availabilityRespectsSchedule() async throws {
        let graph = MockGraph()
        let day = graph.clock.startOfDay(graph.workingTuesday())
        let response = try await graph.booking.availability(AvailabilityQuery(
            branchId: MockGraph.branchId,
            serviceIds: [MockCatalogSeed.serviceLazerBolgesel],
            from: day,
            to: graph.clock.adding(days: 1, to: day)
        ))

        #expect(!response.slots.isEmpty)
        // Personel şablonu 10:00–18:00; şube 09:00'da açılsa da daha erken slot olmamalı.
        let earliest = try #require(response.slots.map(\.startsAt).min())
        #expect(graph.clock.minutesFromMidnight(earliest) >= 10 * 60)

        // 13:00–14:00 mola: o aralıkta başlayan slot çıkmamalı.
        let inBreak = response.slots.filter {
            let minutes = graph.clock.minutesFromMidnight($0.startsAt)
            return minutes >= 13 * 60 && minutes < 14 * 60
        }
        #expect(inBreak.isEmpty)
    }

    @Test("Uygunlukta dolu slot çıkmaz")
    func availabilityExcludesBookedSlots() async throws {
        let graph = MockGraph()
        let start = graph.workingTuesday(hour: 11)
        let day = graph.clock.startOfDay(start)

        func slots() async throws -> [AvailabilitySlot] {
            try await graph.booking.availability(AvailabilityQuery(
                branchId: MockGraph.branchId,
                serviceIds: [MockCatalogSeed.serviceLazerBolgesel],
                from: day,
                to: graph.clock.adding(days: 1, to: day)
            )).slots
        }

        #expect(try await slots().contains { $0.startsAt == start })
        _ = try await graph.booking.create(
            graph.createInput(at: start),
            idempotencyKey: UUID().uuidString
        )
        #expect(try await !slots().contains { $0.startsAt == start })
    }

    @Test("Personelin izinli olduğu aralık uygunlukta çıkmaz")
    func availabilityExcludesLeave() async throws {
        let graph = MockGraph()
        // Seed'de Ayşe'nin bir hafta sonra başlayan üç günlük izni var.
        let exception = try #require(graph.scheduling.snapshotExceptions().first)
        let day = graph.clock.startOfDay(graph.clock.adding(days: 1, to: exception.startsAt))

        let response = try await graph.booking.availability(AvailabilityQuery(
            branchId: MockGraph.branchId,
            serviceIds: [MockCatalogSeed.serviceLazerBolgesel],
            from: day,
            to: graph.clock.adding(days: 1, to: day),
            staffProfileId: MockStaffSeed.profileAyse
        ))
        #expect(response.slots.isEmpty)
    }

    @Test("Takvim yoğunluk verisi saat başına gruplanır")
    func calendarProducesDensity() async throws {
        let graph = MockGraph()
        let start = graph.workingTuesday(hour: 11)
        _ = try await graph.booking.create(
            graph.createInput(at: start),
            idempotencyKey: UUID().uuidString
        )
        _ = try await graph.booking.create(
            graph.createInput(at: graph.clock.adding(minutes: 45, to: start)),
            idempotencyKey: UUID().uuidString
        )

        let calendar = try await graph.booking.calendarDay(CalendarDayQuery(
            branchId: MockGraph.branchId,
            date: graph.clock.localDateString(start)
        ))
        #expect(calendar.appointments.count == 2)
        let bucket = try #require(calendar.density.first { $0.localHour == 11 })
        #expect(bucket.appointmentCount == 2)
        #expect(bucket.localDay == graph.clock.localDateString(start))
    }
}
