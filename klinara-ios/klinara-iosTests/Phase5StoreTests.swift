import Foundation
import Testing
@testable import klinara_ios

/// Faz 5 store'larının davranış testleri.
///
/// İki değişmez sınanıyor: okuma durumu **tek** bir ``LoadState`` içinde
/// yaşar, yazma hataları **yutulmaz** — form onları alanların altında
/// gösterebilmeli.
@MainActor
@Suite("Faz 5 store'ları")
struct Phase5StoreTests {

    private func graph() -> MockGraph { MockGraph() }

    // MARK: Tanımlar

    @Test("Tanım oluşturma listeye ekler")
    func createAddsDefinition() async throws {
        let mock = graph()
        let store = PackageDefinitionStore(service: mock.packages)
        await store.load()
        let before = store.definitions.count

        let created = try await store.create(
            CreatePackageDefinitionInput(
                slug: "yeni-paket",
                name: "Yeni Paket",
                totalPriceMinor: 500_000,
                items: [
                    PackageDefinitionItemInput(
                        serviceId: MockCatalogSeed.serviceHydrafacial,
                        quantity: 3
                    )
                ]
            )
        )

        #expect(store.definitions.count == before + 1)
        #expect(store.definition(id: created.id)?.name == "Yeni Paket")
        #expect(!store.isSaving)
    }

    @Test("Tekrar eden slug çağırana ulaşır ve liste bozulmaz")
    func duplicateSlugSurfaces() async throws {
        let mock = graph()
        let store = PackageDefinitionStore(service: mock.packages)
        await store.load()
        let before = store.definitions.count

        do {
            _ = try await store.create(
                CreatePackageDefinitionInput(
                    slug: "lazer-10-seans",
                    name: "Kopya",
                    totalPriceMinor: 100_000,
                    items: [
                        PackageDefinitionItemInput(
                            serviceId: MockCatalogSeed.serviceHydrafacial,
                            quantity: 1
                        )
                    ]
                )
            )
            Issue.record("Çakışma bekleniyordu")
        } catch let error as APIError {
            if case .problem(let problem) = error {
                #expect(problem.code == .conflict)
            } else {
                Issue.record("Beklenen problem gövdesi yok")
            }
        }

        #expect(store.definitions.count == before)
        #expect(store.state.value != nil)
        #expect(!store.isSaving)
    }

    @Test("Bayat sürümle güncelleme VERSION_CONFLICT verir")
    func staleVersionConflicts() async throws {
        let mock = graph()
        let store = PackageDefinitionStore(service: mock.packages)
        await store.load()
        let target = try #require(store.definitions.first)

        do {
            _ = try await store.update(
                id: target.id,
                version: target.version + 5,
                UpdatePackageDefinitionInput(name: "Bayat")
            )
            Issue.record("Sürüm çakışması bekleniyordu")
        } catch let error as APIError {
            #expect(error.isRetryable == false)
            if case .problem(let problem) = error {
                #expect(problem.code == .versionConflict)
            }
        }
        #expect(store.definition(id: target.id)?.name == target.name)
    }

    @Test("Satılabilir liste pasif ve başka şubenin paketlerini eler")
    func sellableFiltersScope() async throws {
        let mock = graph()
        let store = PackageDefinitionStore(service: mock.packages)
        await store.load()

        // Nişantaşı'nda hem tüm şubelere açık hem şubeye özel paket görünür.
        let nisantasi = store.sellable(in: MockIDs.branchNisantasi)
        #expect(nisantasi.count == 2)

        // Bağdat'ta yalnız tüm şubelere açık olan.
        let bagdat = store.sellable(in: MockIDs.branchBagdat)
        #expect(bagdat.count == 1)
        #expect(bagdat.first?.branchId == nil)
    }

    // MARK: Satış ve defter

    @Test("Satış listeye eklenir; aynı anahtarla ikinci satış YENİ paket üretmez")
    func sellIsIdempotent() async throws {
        let mock = graph()
        let store = CustomerPackagesStore(customerId: MockCustomerSeed.ayse, service: mock.packages)
        await store.load()
        let before = store.packages.count
        let key = UUID().uuidString

        let first = try await store.sell(
            definitionId: MockPackagesSeed.definitionCilt5,
            note: nil,
            idempotencyKey: key
        )
        #expect(store.packages.count == before + 1)

        let second = try await store.sell(
            definitionId: MockPackagesSeed.definitionCilt5,
            note: nil,
            idempotencyKey: key
        )
        #expect(second.id == first.id)
    }

    @Test("Defter yüklenir ve satırların toplamı kalan hakla tutar")
    func ledgerSumMatchesRemaining() async throws {
        let mock = graph()
        let store = CustomerPackagesStore(customerId: MockCustomerSeed.ayse, service: mock.packages)
        await store.load()
        let pkg = try #require(store.package(id: MockPackagesSeed.soldAysePackage))

        await store.loadLedger(packageId: pkg.id)
        let entries = store.ledgerEntries(for: pkg.id)

        #expect(!entries.isEmpty)
        // Kalan hak defterden türetilir; yansımanın toplamla eşitliği Faz 5'in
        // temel değişmezi.
        #expect(entries.reduce(0) { $0 + $1.delta } == pkg.remainingSessions)
    }

    // MARK: Operasyonlar

    @Test("Hak yetersizken düzeltme PACKAGE_EXHAUSTED verir ve kalan hak değişmez")
    func exhaustedSurfaces() async throws {
        let mock = graph()
        let store = CustomerPackagesStore(customerId: MockCustomerSeed.ayse, service: mock.packages)
        await store.load()
        let pkg = try #require(store.package(id: MockPackagesSeed.soldAysePackage))
        let item = try #require(pkg.items.first)

        do {
            try await store.adjust(
                packageId: pkg.id,
                version: pkg.version,
                AdjustPackageInput(
                    items: [
                        AdjustItemInput(
                            customerPackageItemId: item.id,
                            delta: -(item.remainingSessions + 1)
                        )
                    ],
                    reason: "kapasitenin ustunde dusme denemesi"
                )
            )
            Issue.record("PACKAGE_EXHAUSTED bekleniyordu")
        } catch let error as APIError {
            if case .problem(let problem) = error {
                #expect(problem.code == .packageExhausted)
            } else {
                Issue.record("Beklenen problem gövdesi yok")
            }
        }

        #expect(store.package(id: pkg.id)?.remainingSessions == pkg.remainingSessions)
        #expect(store.state.value != nil)
        #expect(!store.isSaving)
    }

    @Test("Düzeltme kalan hakkı yerel kopyaya işler ve deftere iz bırakır")
    func adjustUpdatesLocalCopy() async throws {
        let mock = graph()
        let store = CustomerPackagesStore(customerId: MockCustomerSeed.ayse, service: mock.packages)
        await store.load()
        let pkg = try #require(store.package(id: MockPackagesSeed.soldAysePackage))
        let item = try #require(pkg.items.first)

        try await store.adjust(
            packageId: pkg.id,
            version: pkg.version,
            AdjustPackageInput(
                items: [AdjustItemInput(customerPackageItemId: item.id, delta: -1)],
                reason: "cihaz arizasi telafisi"
            )
        )

        let updated = try #require(store.package(id: pkg.id))
        #expect(updated.remainingSessions == pkg.remainingSessions - 1)
        #expect(updated.version > pkg.version)
        #expect(store.ledgerEntries(for: pkg.id).first?.entryType == .manualAdjustment)
    }

    @Test("İade kalan hakkı düşürür, tutarı satış tahsisinden hesaplar, borcu bekletir")
    func refundUsesSaleAllocation() async throws {
        let mock = graph()
        let store = CustomerPackagesStore(customerId: MockCustomerSeed.ayse, service: mock.packages)
        await store.load()
        let pkg = try #require(store.package(id: MockPackagesSeed.soldAysePackage))
        let item = try #require(pkg.items.first)
        let unit = item.itemTotalMinor / item.quantityTotal

        let result = try await store.refund(
            packageId: pkg.id,
            version: pkg.version,
            RefundPackageInput(
                items: [RefundItemInput(customerPackageItemId: item.id, sessions: 2)],
                reason: "musteri vazgecti"
            ),
            idempotencyKey: UUID().uuidString
        )

        #expect(result.refundedSessions == 2)
        // Liste fiyatından değil, satış anındaki tahsisten.
        #expect(result.refundAmountMinor == unit * 2)
        // Kasa hareketi yok: borç doğdu, tahsilat Faz 6.2'de bağlanacak.
        #expect(result.settlementStatus == "pending")
        #expect(store.package(id: pkg.id)?.remainingSessions == pkg.remainingSessions - 2)
    }

    @Test("Devir hakkı hedefe taşır; iki tarafın toplamı korunur")
    func transferMovesEntitlement() async throws {
        let mock = graph()
        let store = CustomerPackagesStore(customerId: MockCustomerSeed.ayse, service: mock.packages)
        await store.load()
        let pkg = try #require(store.package(id: MockPackagesSeed.soldAysePackage))
        let item = try #require(pkg.items.first)

        let created = try await store.transfer(
            packageId: pkg.id,
            version: pkg.version,
            TransferPackageInput(
                targetCustomerId: MockCustomerSeed.mehmet,
                items: [TransferItemInput(customerPackageItemId: item.id, sessions: 3)],
                reason: "es adina devredildi"
            ),
            idempotencyKey: UUID().uuidString
        )

        #expect(created.customerId == MockCustomerSeed.mehmet)
        #expect(created.transferredFromPackageId == pkg.id)
        #expect(created.remainingSessions == 3)

        let source = try #require(store.package(id: pkg.id))
        #expect(source.remainingSessions == pkg.remainingSessions - 3)
        #expect(store.ledgerEntries(for: pkg.id).first?.entryType == .transferOut)
    }

    @Test("Devredilemez paketin devri çağırana ulaşır")
    func nonTransferablePackageRejects() async throws {
        let mock = graph()
        let store = CustomerPackagesStore(customerId: MockCustomerSeed.ayse, service: mock.packages)
        await store.load()

        // Cilt bakımı paketi devredilemez satılıyor.
        let sold = try await store.sell(
            definitionId: MockPackagesSeed.definitionCilt5,
            note: nil,
            idempotencyKey: UUID().uuidString
        )
        #expect(!sold.isTransferable)

        await #expect(throws: APIError.self) {
            _ = try await store.transfer(
                packageId: sold.id,
                version: sold.version,
                TransferPackageInput(
                    targetCustomerId: MockCustomerSeed.mehmet,
                    items: nil,
                    reason: "devredilemez paket denemesi"
                ),
                idempotencyKey: UUID().uuidString
            )
        }
    }

    @Test("Kullanılabilir haklar yalnız kalanı olan kalemleri döner")
    func entitlementsFilterEmptyItems() async throws {
        let mock = graph()
        let entitlements = try await mock.packages.entitlements(
            customerId: MockCustomerSeed.ayse,
            serviceId: nil,
            branchId: nil
        )
        #expect(entitlements.allSatisfy { $0.remainingSessions > 0 })
        #expect(entitlements.contains { $0.serviceId == MockCatalogSeed.serviceLazerBolgesel })
    }

    // MARK: Gövde doğrulaması

    @Test("Gerekçesiz düzeltme istemcide de geçersizdir")
    func adjustRequiresReason() {
        let short = AdjustPackageInput(
            items: [AdjustItemInput(customerPackageItemId: "x", delta: -1)],
            reason: "kısa"
        )
        #expect(!short.isValid)

        let zeroDelta = AdjustPackageInput(
            items: [AdjustItemInput(customerPackageItemId: "x", delta: 0)],
            reason: "yeterince uzun gerekce"
        )
        #expect(!zeroDelta.isValid)

        let valid = AdjustPackageInput(
            items: [AdjustItemInput(customerPackageItemId: "x", delta: -1)],
            reason: "yeterince uzun gerekce"
        )
        #expect(valid.isValid)
    }
}
