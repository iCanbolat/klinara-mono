import Foundation

/// Mock paket verisinin başlangıç durumu.
///
/// İki tanım kasıtlı olarak farklı: biri **çok kalemli ve indirimli** (10 ortodonti
/// kontrolü + 2 temizlik), diğeri tek kalemli ve süresiz. Faz 5'in var olma sebebi olan
/// hata — 12 seansın hepsinin kontrol olarak tüketilmesi — ancak çok kalemli bir
/// paketle ekranda sınanabilir.
enum MockPackagesSeed {

    static let definitionOrtodonti10 = "f1000000-0000-4000-8000-000000000001"
    static let definitionDolgu5 = "f1000000-0000-4000-8000-000000000002"

    static let soldAysePackage = "f2000000-0000-4000-8000-000000000001"
    static let soldAyseItemKontrol = "f3000000-0000-4000-8000-000000000001"
    static let soldAyseItemTemizlik = "f3000000-0000-4000-8000-000000000002"

    static func definitions(at now: Date) -> [PackageDefinition] {
        [
            PackageDefinition(
                id: definitionOrtodonti10,
                branchId: nil,
                slug: "ortodonti-10-kontrol",
                name: "Ortodonti: 10 Kontrol + 2 Temizlik",
                description: "Tedavi süresince aylık kontroller, iki diş taşı temizliği dahil.",
                totalPriceMinor: 1_200_000,
                // 10 × 120.000 + 2 × 180.000 = 1.560.000 → %23 indirim.
                listPriceMinor: 1_560_000,
                currency: "TRY",
                validityDays: 365,
                isTransferable: true,
                isOnlineSellable: true,
                isActive: true,
                revision: 1,
                version: 1,
                items: [
                    PackageDefinitionItem(
                        id: "f4000000-0000-4000-8000-000000000001",
                        serviceId: MockCatalogSeed.serviceOrtodontiKontrol,
                        serviceName: "Ortodonti Kontrolü",
                        quantity: 10,
                        unitListPriceMinor: 120_000,
                        sortOrder: 0
                    ),
                    PackageDefinitionItem(
                        id: "f4000000-0000-4000-8000-000000000002",
                        serviceId: MockCatalogSeed.serviceDisTasiTemizligi,
                        serviceName: "Diş Taşı Temizliği",
                        quantity: 2,
                        unitListPriceMinor: 180_000,
                        sortOrder: 1
                    ),
                ],
                createdAt: now,
                updatedAt: now,
                deletedAt: nil
            ),
            PackageDefinition(
                id: definitionDolgu5,
                branchId: MockIDs.branchNisantasi,
                slug: "kompozit-dolgu-5",
                name: "5 Kompozit Dolgu",
                description: nil,
                totalPriceMinor: 800_000,
                listPriceMinor: 900_000,
                currency: "TRY",
                // Süresiz paket — "geçerlilik yok" ile "0 gün" farkı ekranda sınansın.
                validityDays: nil,
                isTransferable: false,
                isOnlineSellable: false,
                isActive: true,
                revision: 2,
                version: 3,
                items: [
                    PackageDefinitionItem(
                        id: "f4000000-0000-4000-8000-000000000003",
                        serviceId: MockCatalogSeed.serviceKompozitDolgu,
                        serviceName: "Kompozit Dolgu",
                        quantity: 5,
                        unitListPriceMinor: 180_000,
                        sortOrder: 0
                    )
                ],
                createdAt: now,
                updatedAt: now,
                deletedAt: nil
            ),
        ]
    }

    /// Ayşe'nin yarısı kullanılmış paketi: defter zaten dolu, ekran boş
    /// durumla değil gerçek bir geçmişle açılıyor.
    static func soldPackage(at now: Date) -> CustomerPackage {
        CustomerPackage(
            id: soldAysePackage,
            customerId: MockCustomerSeed.ayse,
            branchId: MockIDs.branchNisantasi,
            definitionId: definitionOrtodonti10,
            name: "Ortodonti: 10 Kontrol + 2 Temizlik",
            definitionRevision: 1,
            totalPriceMinor: 1_200_000,
            currency: "TRY",
            isTransferable: true,
            validityDays: 365,
            soldAt: now.addingTimeInterval(-60 * 86_400),
            expiresAt: now.addingTimeInterval(305 * 86_400),
            status: .active,
            remainingSessions: 7,
            // Kalemlerin kalan karşılıklarının toplamı: 553.846 + 138.462.
            outstandingMinor: 692_308,
            refundedSessions: 0,
            refundAmountMinor: 0,
            refundedAt: nil,
            refundReason: nil,
            transferredFromPackageId: nil,
            note: nil,
            version: 4,
            items: [
                CustomerPackageItem(
                    id: soldAyseItemKontrol,
                    serviceId: MockCatalogSeed.serviceOrtodontiKontrol,
                    serviceName: "Ortodonti Kontrolü",
                    quantityTotal: 10,
                    remainingSessions: 6,
                    unitListPriceMinor: 120_000,
                    itemTotalMinor: 923_077,
                    outstandingMinor: 553_846,
                    sortOrder: 0
                ),
                CustomerPackageItem(
                    id: soldAyseItemTemizlik,
                    serviceId: MockCatalogSeed.serviceDisTasiTemizligi,
                    serviceName: "Diş Taşı Temizliği",
                    quantityTotal: 2,
                    remainingSessions: 1,
                    unitListPriceMinor: 180_000,
                    itemTotalMinor: 276_923,
                    outstandingMinor: 138_462,
                    sortOrder: 1
                ),
            ],
            createdAt: now.addingTimeInterval(-60 * 86_400)
        )
    }

    /// Satış + dört kullanım + bir düzeltme: defter ekranının bütün satır
    /// tiplerini (ters kayıt dahil) tek pakette gösteriyor.
    static func ledger(for package: CustomerPackage, at now: Date) -> [PackageLedgerEntry] {
        let kontrol = package.items[0]
        let bakim = package.items[1]
        var entries: [PackageLedgerEntry] = []

        func entry(
            _ item: CustomerPackageItem,
            _ type: LedgerEntryType,
            _ delta: Int,
            daysAgo: Int,
            reason: String? = nil,
            reverses: String? = nil
        ) -> PackageLedgerEntry {
            PackageLedgerEntry(
                id: MockIDs.uuid(),
                customerPackageItemId: item.id,
                serviceId: item.serviceId,
                serviceName: item.serviceName,
                entryType: type,
                delta: delta,
                appointmentId: type == .consume ? MockIDs.uuid() : nil,
                actorUserId: MockIDs.userOwner,
                reason: reason,
                reversesEntryId: reverses,
                createdAt: now.addingTimeInterval(TimeInterval(-daysAgo) * 86_400)
            )
        }

        entries.append(entry(kontrol, .purchase, 10, daysAgo: 60))
        entries.append(entry(bakim, .purchase, 2, daysAgo: 60))
        entries.append(entry(kontrol, .consume, -1, daysAgo: 50))
        entries.append(entry(kontrol, .consume, -1, daysAgo: 36))
        entries.append(entry(kontrol, .consume, -1, daysAgo: 22))
        let reversed = entry(kontrol, .consume, -1, daysAgo: 14)
        entries.append(reversed)
        entries.append(
            entry(
                kontrol, .consume, 1, daysAgo: 14,
                reason: "Randevu tamamlanmadan işaretlenmiş",
                reverses: reversed.id
            )
        )
        entries.append(entry(bakim, .consume, -1, daysAgo: 5))
        entries.append(
            entry(kontrol, .manualAdjustment, -1, daysAgo: 2, reason: "Braket kırığı, ek kontrol")
        )
        return entries.sorted { $0.createdAt > $1.createdAt }
    }
}
