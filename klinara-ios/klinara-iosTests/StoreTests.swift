import Foundation
import Testing
@testable import klinara_ios

/// Store'ların iki sözü var: okuma durumu tek bir ``LoadState``'te yaşar ve
/// **yazma hatası yutulmaz**. İkincisi önemli: hatayı store yutup listede
/// gösterseydi form kendi alanının altına hiçbir şey yazamazdı.
@MainActor
@Suite("CalendarStore")
struct CalendarStoreTests {

    private func makeStore(_ graph: MockGraph) async -> CalendarStore {
        let catalog = CatalogStore(service: graph.catalog)
        await catalog.load()
        let store = CalendarStore(
            service: graph.booking,
            catalog: catalog,
            today: graph.workingTuesday()
        )
        store.cacheCustomers(graph.customers.snapshot)
        return store
    }

    @Test("Şube seçilmeden yükleme yapılmaz")
    func requiresBranch() async {
        let graph = MockGraph()
        let store = await makeStore(graph)
        await store.load(branchId: nil, clock: graph.clock)

        // Sunucuya gitmeden söylenebilecek bir şey için istek atmanın anlamı yok.
        #expect(store.state.error?.code == .validationFailed)
    }

    @Test("Gün yüklenir ve boş gelir")
    func loadsEmptyDay() async {
        let graph = MockGraph(scenario: .emptyDay)
        let store = await makeStore(graph)
        await store.load(branchId: MockGraph.branchId, clock: graph.clock)

        #expect(store.state.value != nil)
        #expect(store.entries.isEmpty)
    }

    @Test("Oluşturma listeye yeniden çekmeden işlenir")
    func mergesCreatedAppointment() async throws {
        let graph = MockGraph(scenario: .emptyDay)
        let store = await makeStore(graph)
        await store.load(branchId: MockGraph.branchId, clock: graph.clock)

        let created = try await store.create(graph.createInput(at: graph.workingTuesday()))

        #expect(store.entries.count == 1)
        let entry = try #require(store.entries.first)
        #expect(entry.id == created.id)
        // Müşteri adı detay yanıtında yok; önbellekten kurulmuş olmalı.
        #expect(entry.customerName == "Ayşe Yılmaz")
        #expect(entry.serviceSummary == "Bölgesel Lazer Epilasyon")
    }

    @Test("Çakışma hatası çağırana ulaşır ve liste bozulmaz")
    func surfacesSlotConflictWithoutCorruptingList() async throws {
        let graph = MockGraph(scenario: .emptyDay)
        let store = await makeStore(graph)
        await store.load(branchId: MockGraph.branchId, clock: graph.clock)

        let start = graph.workingTuesday()
        _ = try await store.create(graph.createInput(at: start))
        #expect(store.entries.count == 1)

        do {
            _ = try await store.create(graph.createInput(at: start))
            Issue.record("Çakışma hatası yutuldu")
        } catch let error as APIError {
            #expect(error.code == .slotConflict)
        }

        // Liste durumu bozulmamalı: hata formun işi, listenin değil.
        #expect(store.state.value != nil)
        #expect(store.entries.count == 1)
        #expect(!store.isSaving)
    }

    @Test("İptal durumu yerelde çevirir ve satırı aktif listeden düşürür")
    func cancelFlipsStatusLocally() async throws {
        let graph = MockGraph(scenario: .emptyDay)
        let store = await makeStore(graph)
        await store.load(branchId: MockGraph.branchId, clock: graph.clock)

        let created = try await store.create(graph.createInput(at: graph.workingTuesday()))
        #expect(store.activeEntries.count == 1)

        _ = try await store.cancel(created, reason: "Müşteri vazgeçti")

        // Kayıt kaybolmaz, ayrı gruba düşer: görünmez olsaydı "iptal etmiş
        // miydim?" sorusu cevapsız kalırdı.
        #expect(store.activeEntries.isEmpty)
        #expect(store.terminalEntries.count == 1)
        #expect(store.entries.count == 1)
    }

    @Test("Bayat sürümde VERSION_CONFLICT çağırana ulaşır")
    func surfacesVersionConflict() async throws {
        let graph = MockGraph(scenario: .emptyDay)
        let store = await makeStore(graph)
        await store.load(branchId: MockGraph.branchId, clock: graph.clock)

        let created = try await store.create(graph.createInput(at: graph.workingTuesday()))
        _ = try await store.updateNotes(created, notes: "İlk not")

        do {
            // Elimizdeki kopya artık bayat.
            _ = try await store.updateNotes(created, notes: "İkinci not")
            Issue.record("Bayat sürüm kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .versionConflict)
        }
    }

    @Test("Görüntülenen günün dışına ertelenen randevu listeden düşer")
    func rescheduleOutOfRangeRemovesEntry() async throws {
        let graph = MockGraph(scenario: .emptyDay)
        let store = await makeStore(graph)
        await store.load(branchId: MockGraph.branchId, clock: graph.clock)

        let created = try await store.create(graph.createInput(at: graph.workingTuesday()))
        #expect(store.entries.count == 1)

        // Bir hafta sonrasına ertele — bakılan gün değişmedi.
        let nextWeek = graph.clock.adding(days: 7, to: graph.workingTuesday())
        _ = try await store.reschedule(created, RescheduleAppointmentInput(
            startsAt: graph.clock.wireValue(nextWeek)
        ))

        // Kullanıcının bakmadığı bir günü bu güne çizmek yanlış olurdu.
        #expect(store.entries.isEmpty)
    }

    @Test("Personel filtresi dışındaki randevu listeye girmez")
    func respectsStaffFilterOnMerge() async throws {
        let graph = MockGraph(scenario: .emptyDay)
        let store = await makeStore(graph)
        store.filter(staffProfileId: MockStaffSeed.profileMehmet)
        await store.load(branchId: MockGraph.branchId, clock: graph.clock)

        _ = try await store.create(graph.createInput(at: graph.workingTuesday()))

        // Randevu Ayşe'ye açıldı; Mehmet filtresi altında görünmemeli.
        #expect(store.entries.isEmpty)
    }

    @Test("Gün gezinmesi yükleme anahtarını değiştirir")
    func navigationChangesLoadKey() async {
        let graph = MockGraph()
        let store = await makeStore(graph)
        let before = store.loadKey(clock: graph.clock, branchId: MockGraph.branchId)

        store.shift(days: 1, clock: graph.clock)
        let after = store.loadKey(clock: graph.clock, branchId: MockGraph.branchId)

        #expect(before != after)
        #expect(after.day == graph.clock.localDateString(
            graph.clock.adding(days: 1, to: graph.workingTuesday())
        ))
    }
}

@MainActor
@Suite("CustomerStore")
struct CustomerStoreTests {

    @Test("Liste yüklenir, ikinci çağrı yeniden çekmez")
    func cachesAfterFirstLoad() async {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)

        await store.load()
        let first = store.customers
        await store.load()

        #expect(!first.isEmpty)
        #expect(store.customers == first)
    }

    @Test("Mükerrer telefon 409 verir ve liste değişmez")
    func rejectsDuplicatePhone() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)
        await store.load()
        let before = store.customers.count

        do {
            _ = try await store.create(CreateCustomerInput(
                fullName: "Kopya Kayıt",
                phone: "+905321112233"     // Ayşe'nin numarası
            ))
            Issue.record("Mükerrer telefon kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .conflict)
        }
        #expect(store.customers.count == before)
    }

    @Test("Telefon serbest biçimde gönderilip E.164'e normalize edilir")
    func normalizesPhone() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)
        await store.load()

        let created = try await store.create(CreateCustomerInput(
            fullName: "Yeni Müşteri",
            phone: "0555 987 65 43"
        ))
        #expect(created.phone == "+905559876543")
        #expect(store.customers.first?.id == created.id)
    }

    @Test("Geçersiz telefon alan bazlı hata verir")
    func rejectsInvalidPhone() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)
        await store.load()

        do {
            _ = try await store.create(CreateCustomerInput(fullName: "Eksik", phone: "555 12"))
            Issue.record("Geçersiz telefon kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .validationFailed)
            #expect(error.fieldErrors["phone"] != nil)
            #expect(error.isFieldScoped)
        }
    }

    @Test("null gönderimi alanı temizler, gönderilmemesi dokunmaz")
    func distinguishesClearFromUnchanged() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)
        await store.load()

        // Sadece notu değiştir — e-posta ve telefon gönderilmiyor.
        let touched = try await store.update(
            id: MockCustomerSeed.ayse,
            UpdateCustomerInput(notes: .set("Cilt hassasiyeti"))
        )
        #expect(touched.notes == "Cilt hassasiyeti")
        #expect(touched.email == "ayse@ornek.test")
        #expect(touched.phone == "+905321112233")

        // Şimdi e-postayı açıkça temizle.
        let cleared = try await store.update(
            id: MockCustomerSeed.ayse,
            UpdateCustomerInput(email: .clear)
        )
        #expect(cleared.email == nil)
        #expect(cleared.notes == "Cilt hassasiyeti")
    }

    @Test("Telefon temizlenince numara yeniden kullanılabilir")
    func clearingPhoneFreesTheNumber() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)
        await store.load()

        _ = try await store.update(id: MockCustomerSeed.ayse, UpdateCustomerInput(phone: .clear))
        let reused = try await store.create(CreateCustomerInput(
            fullName: "Numarayı Devralan",
            phone: "+905321112233"
        ))
        #expect(reused.phone == "+905321112233")
    }

    @Test("Arşivleme listeden düşürür")
    func archiveRemovesFromList() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)
        await store.load()
        let before = store.customers.count

        _ = try await store.archive(id: MockCustomerSeed.ayse)

        #expect(store.customers.count == before - 1)
        #expect(store.customer(id: MockCustomerSeed.ayse) == nil)
        // İkinci arşivleme 404 alır — sunucudaki davranışın aynısı.
        await #expect(throws: APIError.self) {
            try await store.archive(id: MockCustomerSeed.ayse)
        }
    }

    /// Liste ekranı artık `GET /customers/search`e gidiyor (bkz.
    /// `CustomerSearchAndTagTests`); YEREL eşleşme randevu akışındaki müşteri
    /// seçici gibi zaten elde olan kaydı süzen yerlerde kalıyor.
    @Test("Yerel eşleşme Türkçe katlamayla çalışır")
    func matchesLocally() async {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)
        await store.load()

        let zeynep = store.customers.first { $0.id == MockCustomerSeed.zeynep }
        #expect(zeynep?.matches("") == true)
        #expect(zeynep?.matches("zeynep") == true)
        #expect(zeynep?.matches("KAYA") == true)      // Türkçe katlama
        #expect(zeynep?.matches("0532 777") == true)  // biçimli telefon
        #expect(zeynep?.matches("bulunamaz") == false)
    }
}
