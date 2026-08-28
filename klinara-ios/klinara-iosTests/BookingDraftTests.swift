import Foundation
import Testing
@testable import klinara_ios

/// Form katmanı: seçimlerin wire gövdesine nasıl döndüğü.
///
/// Görünüm hiçbir alanı sunucu biçimine kendi çevirmez; hepsi burada olur ve
/// burada test edilir.
@Suite("BookingDraft")
struct BookingDraftTests {

    private let clock = BranchClock(timeZoneIdentifier: "Europe/Istanbul")
    private let services = MockCatalogSeed.services(at: Date())
    private let profiles = MockStaffSeed.profiles(
        services: MockCatalogSeed.services(at: Date()),
        at: Date()
    )

    private func slot(at hour: Int, staff: [String] = [MockStaffSeed.profileAyse]) -> AvailabilitySlot {
        let day = clock.date(fromLocalDateString: "2026-09-08") ?? Date()
        let start = clock.date(on: day, at: ClockTime(hour: hour, minute: 0))
        return AvailabilitySlot(
            startsAt: start,
            endsAt: clock.adding(minutes: 30, to: start),
            staffProfileIds: staff
        )
    }

    @Test("Boş taslak geçerli değil")
    func startsInvalid() {
        var draft = BookingDraft(branchId: MockIDs.branchNisantasi)
        #expect(!draft.isValid)
        #expect(!draft.isDirty)
        #expect(!draft.canQueryAvailability)

        draft.customerId = MockCustomerSeed.ayse
        draft.toggle(serviceId: MockCatalogSeed.serviceLazerBolgesel)
        #expect(draft.canQueryAvailability)
        // Slot seçilmeden hâlâ geçersiz.
        #expect(!draft.isValid)

        draft.select(slot: slot(at: 11))
        #expect(draft.isValid)
        #expect(draft.isDirty)
    }

    @Test("Hizmet seçim sırası korunur")
    func preservesServiceOrder() {
        var draft = BookingDraft(branchId: MockIDs.branchNisantasi)
        draft.toggle(serviceId: MockCatalogSeed.serviceHydrafacial)
        draft.toggle(serviceId: MockCatalogSeed.serviceLazerBolgesel)

        // Sunucu bu sırayı ardışık işlem zinciri için kullanıyor; sıralamak
        // ya da kümeye çevirmek randevunun akışını değiştirirdi.
        #expect(draft.serviceIds == [
            MockCatalogSeed.serviceHydrafacial,
            MockCatalogSeed.serviceLazerBolgesel,
        ])

        draft.toggle(serviceId: MockCatalogSeed.serviceHydrafacial)
        #expect(draft.serviceIds == [MockCatalogSeed.serviceLazerBolgesel])
    }

    @Test("Hizmet değişince slot seçimi düşer")
    func resetsSlotWhenLineupChanges() {
        var draft = BookingDraft(branchId: MockIDs.branchNisantasi)
        draft.toggle(serviceId: MockCatalogSeed.serviceLazerBolgesel)
        draft.select(slot: slot(at: 11))
        #expect(draft.slot != nil)

        // Süre değişti; eski slot artık geçerli olmayabilir. Sessizce taşımak
        // kullanıcıya sormadan başka bir saate randevu yazmak olurdu.
        draft.toggle(serviceId: MockCatalogSeed.serviceHydrafacial)
        #expect(draft.slot == nil)

        draft.select(slot: slot(at: 11))
        draft.select(staffProfileId: MockStaffSeed.profileAyse)
        #expect(draft.slot == nil)
    }

    @Test("Süre ve tutar seçili hizmetlerden hesaplanır")
    func computesTotals() {
        var draft = BookingDraft(branchId: MockIDs.branchNisantasi)
        draft.toggle(serviceId: MockCatalogSeed.serviceLazerBolgesel)  // 30 dk, 5/10, 900 ₺

        #expect(draft.visibleMinutes(services: services) == 30)
        #expect(draft.occupiedMinutes(services: services) == 45)
        #expect(draft.totalMinor(services: services) == 90_000)

        draft.toggle(serviceId: MockCatalogSeed.serviceHydrafacial)    // 60 dk, 5/10, 1800 ₺
        #expect(draft.visibleMinutes(services: services) == 90)
        #expect(draft.occupiedMinutes(services: services) == 45 + 75)
        #expect(draft.totalMinor(services: services) == 270_000)
    }

    @Test("Şube override'ı süre ve fiyata yansır")
    func appliesBranchOverride() {
        // Bağdat şubesinde tüm vücut lazer 90 değil 75 dakika ve daha pahalı.
        var main = BookingDraft(branchId: MockIDs.branchNisantasi)
        main.toggle(serviceId: MockCatalogSeed.serviceLazerTumVucut)
        var other = BookingDraft(branchId: MockIDs.branchBagdat)
        other.toggle(serviceId: MockCatalogSeed.serviceLazerTumVucut)

        #expect(main.visibleMinutes(services: services) == 90)
        #expect(other.visibleMinutes(services: services) == 75)
        #expect(main.totalMinor(services: services) == 250_000)
        #expect(other.totalMinor(services: services) == 285_000)
    }

    @Test("Slot seçimi aday personel yoksa ilk adayı atar")
    func picksCandidateStaff() {
        var draft = BookingDraft(branchId: MockIDs.branchNisantasi)
        draft.toggle(serviceId: MockCatalogSeed.serviceLazerBolgesel)

        draft.select(slot: slot(at: 11, staff: [
            MockStaffSeed.profileMehmet,
            MockStaffSeed.profileAyse,
        ]))
        // "Herkes olur" durumunda kullanıcıya personel seçtirmeye gerek yok.
        #expect(draft.staffProfileId == MockStaffSeed.profileMehmet)

        // Seçili personel aday kümesindeyse korunur.
        draft.select(staffProfileId: MockStaffSeed.profileAyse)
        draft.select(slot: slot(at: 12, staff: [
            MockStaffSeed.profileMehmet,
            MockStaffSeed.profileAyse,
        ]))
        #expect(draft.staffProfileId == MockStaffSeed.profileAyse)
    }

    @Test("Yalnız hepsini verebilen personel aday olur")
    func filtersEligibleStaff() {
        var draft = BookingDraft(branchId: MockIDs.branchNisantasi)
        draft.toggle(serviceId: MockCatalogSeed.serviceHydrafacial)

        // Mehmet yalnız Bağdat şubesinde epilasyon yapıyor.
        let eligible = draft.eligibleStaff(profiles).map(\.id)
        #expect(eligible == [MockStaffSeed.profileAyse])
    }

    @Test("Oluşturma gövdesi şube offset'li saat taşır")
    func buildsCreateInput() throws {
        var draft = BookingDraft(branchId: MockIDs.branchNisantasi)
        draft.customerId = MockCustomerSeed.ayse
        draft.toggle(serviceId: MockCatalogSeed.serviceLazerBolgesel)
        draft.toggle(serviceId: MockCatalogSeed.serviceHydrafacial)
        draft.select(slot: slot(at: 11))
        draft.notes = "  İlk seans  "

        let input = try #require(draft.createInput(clock: clock))
        #expect(input.branchId == MockIDs.branchNisantasi)
        #expect(input.customerId == MockCustomerSeed.ayse)
        #expect(input.startsAt == "2026-09-08T11:00:00.000+03:00")
        #expect(input.services.map(\.serviceId) == draft.serviceIds)
        #expect(input.services.allSatisfy { $0.staffProfileId == MockStaffSeed.profileAyse })
        // Not kırpılır; boşluktan ibaret bir not `nil` olmalı.
        #expect(input.notes == "İlk seans")

        draft.notes = "   "
        #expect(try #require(draft.createInput(clock: clock)).notes == nil)
    }

    @Test("Eksik seçimde gövde üretilmez")
    func refusesIncompleteInput() {
        var draft = BookingDraft(branchId: MockIDs.branchNisantasi)
        draft.toggle(serviceId: MockCatalogSeed.serviceLazerBolgesel)
        draft.select(slot: slot(at: 11))
        // Müşteri seçilmedi.
        #expect(draft.createInput(clock: clock) == nil)
    }

    @Test("Erteleme taslağı mevcut dizilimi devralır ve kilitler")
    func rescheduleInheritsLineup() throws {
        let appointment = try Fixtures.decode(Appointment.self, from: Fixtures.appointment)
        var draft = BookingDraft(branchId: appointment.branchId, rescheduling: appointment)

        #expect(draft.isRescheduling)
        #expect(!draft.canEditLineup)
        #expect(draft.customerId == appointment.customerId)
        #expect(draft.serviceIds == appointment.services.map(\.serviceId))
        #expect(draft.staffProfileId == appointment.services.first?.staffProfileId)
        // Yalnız saat değişecek; taslak henüz kirli değil.
        #expect(!draft.isDirty)

        draft.select(slot: slot(at: 15))
        #expect(draft.isDirty)

        let input = try #require(draft.rescheduleInput(clock: clock))
        #expect(input.startsAt == "2026-09-08T15:00:00.000+03:00")
        #expect(input.services?.count == appointment.services.count)
    }

    @Test("Seçili paket kalemi gövdeye yazılır")
    func carriesPackageBinding() throws {
        var draft = BookingDraft(branchId: MockIDs.branchNisantasi)
        draft.select(customerId: MockCustomerSeed.ayse)
        draft.toggle(serviceId: MockCatalogSeed.serviceLazerBolgesel)
        draft.toggle(serviceId: MockCatalogSeed.serviceHydrafacial)
        draft.select(slot: slot(at: 11))
        draft.selectPackageItem(
            MockPackagesSeed.soldAyseItemLazer,
            for: MockCatalogSeed.serviceLazerBolgesel
        )

        let input = try #require(draft.createInput(clock: clock))
        let lazer = input.services.first { $0.serviceId == MockCatalogSeed.serviceLazerBolgesel }
        let bakim = input.services.first { $0.serviceId == MockCatalogSeed.serviceHydrafacial }
        #expect(lazer?.customerPackageItemId == MockPackagesSeed.soldAyseItemLazer)
        // Seçilmeyen hizmet paketsiz gider; `nil` "paketten düşme" demek.
        #expect(bakim?.customerPackageItemId == nil)

        // Aynı kaleme ikinci dokunuş seçimi kaldırır.
        draft.selectPackageItem(
            MockPackagesSeed.soldAyseItemLazer,
            for: MockCatalogSeed.serviceLazerBolgesel
        )
        #expect(try #require(draft.createInput(clock: clock))
            .services.allSatisfy { $0.customerPackageItemId == nil })
    }

    @Test("Müşteri değişince paket seçimi düşer")
    func packageBindingResetsWithCustomer() throws {
        var draft = BookingDraft(branchId: MockIDs.branchNisantasi)
        draft.select(customerId: MockCustomerSeed.ayse)
        draft.toggle(serviceId: MockCatalogSeed.serviceLazerBolgesel)
        draft.select(slot: slot(at: 11))
        draft.selectPackageItem(
            MockPackagesSeed.soldAyseItemLazer,
            for: MockCatalogSeed.serviceLazerBolgesel
        )

        // Haklar müşteriye özeldir: taşınan bir seçim BAŞKASININ paketinden
        // seans düşürürdü.
        draft.select(customerId: MockCustomerSeed.mehmet)

        #expect(draft.packageItemIds.isEmpty)
        #expect(try #require(draft.createInput(clock: clock))
            .services.allSatisfy { $0.customerPackageItemId == nil })
    }

    @Test("Hizmet çıkarılınca paket bağı da düşer")
    func packageBindingDropsWithService() {
        var draft = BookingDraft(branchId: MockIDs.branchNisantasi)
        draft.toggle(serviceId: MockCatalogSeed.serviceLazerBolgesel)
        draft.selectPackageItem(
            MockPackagesSeed.soldAyseItemLazer,
            for: MockCatalogSeed.serviceLazerBolgesel
        )
        draft.toggle(serviceId: MockCatalogSeed.serviceLazerBolgesel)

        #expect(draft.packageItemIds.isEmpty)
    }

    @Test("Erteleme modunda hizmet seçimi değiştirilemez")
    func rescheduleKeepsLineupLocked() throws {
        let appointment = try Fixtures.decode(Appointment.self, from: Fixtures.appointment)
        let draft = BookingDraft(branchId: appointment.branchId, rescheduling: appointment)
        // Ekran `canEditLineup` false iken dokunuşları yok sayıyor; bayrağın
        // kendisi burada sabitleniyor.
        #expect(!draft.canEditLineup)
    }
}
