import Foundation

/// Mock katalogun başlangıç verisi.
///
/// Gerçek bir diş kliniğinin hizmet listesine benzemesi kasıtlı:
/// tasarım kararları (satır yüksekliği, uzun hizmet adının kırpılması, buffer'lı
/// hizmetin görünümü) ancak gerçekçi metinle sınanabilir.
enum MockCatalogSeed {

    static let categoryGenel = "d1000000-0000-4000-8000-000000000001"
    static let categoryKoruyucu = "d1000000-0000-4000-8000-000000000002"
    static let categoryEstetik = "d1000000-0000-4000-8000-000000000003"

    static let serviceKanalTedavisi = "e1000000-0000-4000-8000-000000000001"
    static let serviceOrtodontiKontrol = "e1000000-0000-4000-8000-000000000002"
    static let serviceDisTasiTemizligi = "e1000000-0000-4000-8000-000000000003"
    static let serviceKompozitDolgu = "e1000000-0000-4000-8000-000000000004"
    static let serviceBeyazlatma = "e1000000-0000-4000-8000-000000000005"
    static let serviceImplant = "e1000000-0000-4000-8000-000000000006"

    static func categories(at now: Date) -> [ServiceCategory] {
        [
            ServiceCategory(
                id: categoryGenel, tenantId: MockIDs.tenant, slug: "genel-dis-hekimligi",
                name: "Genel Diş Hekimliği", sortOrder: 0, isActive: true, createdAt: now
            ),
            ServiceCategory(
                id: categoryKoruyucu, tenantId: MockIDs.tenant, slug: "koruyucu-restoratif",
                name: "Koruyucu ve Restoratif", sortOrder: 1, isActive: true, createdAt: now
            ),
            ServiceCategory(
                id: categoryEstetik, tenantId: MockIDs.tenant, slug: "estetik-cerrahi",
                name: "Estetik ve Cerrahi", sortOrder: 2, isActive: true, createdAt: now
            ),
        ]
    }

    static func services(at now: Date) -> [ClinicService] {
        [
            service(
                id: serviceKanalTedavisi, category: categoryGenel,
                slug: "kanal-tedavisi", name: "Kanal Tedavisi",
                description: "Tek kanallı dişte tek seans kanal tedavisi.",
                duration: 90, before: 10, after: 15, price: 250_000,
                color: "#7F9A76", at: now,
                overrides: [
                    // Bağdat Caddesi şubesinde mikroskoplu endodonti: daha kısa, daha pahalı.
                    BranchServiceOverride(
                        id: MockIDs.uuid(), tenantId: MockIDs.tenant,
                        serviceId: serviceKanalTedavisi, branchId: MockIDs.branchBagdat,
                        durationMinutes: 75, bufferBeforeMinutes: nil, bufferAfterMinutes: nil,
                        priceMinor: 285_000, vatRateBasisPoints: nil,
                        isOnlineBookable: nil, isActive: nil, createdAt: now
                    )
                ]
            ),
            service(
                id: serviceOrtodontiKontrol, category: categoryGenel,
                slug: "ortodonti-kontrolu", name: "Ortodonti Kontrolü",
                description: "Braket veya şeffaf plak aylık kontrolü.",
                duration: 30, before: 5, after: 10, price: 90_000,
                color: "#9DB894", at: now
            ),
            service(
                id: serviceDisTasiTemizligi, category: categoryKoruyucu,
                slug: "dis-tasi-temizligi", name: "Diş Taşı Temizliği",
                description: "Detertraj ve polisaj.",
                duration: 60, before: 5, after: 10, price: 180_000,
                color: "#5E7856", at: now
            ),
            service(
                id: serviceKompozitDolgu, category: categoryKoruyucu,
                slug: "kompozit-dolgu", name: "Kompozit Dolgu",
                description: nil,
                duration: 45, before: 5, after: 15, price: 140_000,
                color: "#A6483C", at: now, isOnlineBookable: false
            ),
            service(
                id: serviceBeyazlatma, category: categoryEstetik,
                slug: "ofis-tipi-beyazlatma", name: "Diş Beyazlatma — Ofis Tipi",
                description: "Tek seans, iki çene.",
                duration: 60, before: 10, after: 10, price: 650_000,
                color: "#2E3532", at: now, isOnlineBookable: false
            ),
            service(
                id: serviceImplant, category: categoryEstetik,
                slug: "implant-cerrahisi", name: "İmplant Cerrahisi",
                description: "Tek diş implant uygulaması.",
                duration: 90, before: 15, after: 15, price: 2_500_000,
                color: "#6E7A74", at: now, isOnlineBookable: false, isActive: false
            ),
        ]
    }

    /// Formdan gelen override girdilerini yanıt biçimine çevirir.
    static func overrides(
        from inputs: [BranchServiceOverrideInput],
        serviceId: String
    ) -> [BranchServiceOverride] {
        inputs.filter { !$0.isEmpty }.map { input in
            BranchServiceOverride(
                id: MockIDs.uuid(),
                tenantId: MockIDs.tenant,
                serviceId: serviceId,
                branchId: input.branchId,
                durationMinutes: input.durationMinutes,
                bufferBeforeMinutes: input.bufferBeforeMinutes,
                bufferAfterMinutes: input.bufferAfterMinutes,
                priceMinor: input.priceMinor,
                vatRateBasisPoints: input.vatRateBasisPoints,
                isOnlineBookable: input.isOnlineBookable,
                isActive: input.isActive,
                createdAt: Date()
            )
        }
    }

    // swiftlint:disable:next function_parameter_count
    private static func service(
        id: String,
        category: String,
        slug: String,
        name: String,
        description: String?,
        duration: Int,
        before: Int,
        after: Int,
        price: Int,
        color: String,
        at now: Date,
        isOnlineBookable: Bool = true,
        isActive: Bool = true,
        overrides: [BranchServiceOverride] = []
    ) -> ClinicService {
        ClinicService(
            id: id, tenantId: MockIDs.tenant, categoryId: category,
            slug: slug, name: name, description: description,
            durationMinutes: duration,
            bufferBeforeMinutes: before, bufferAfterMinutes: after,
            priceMinor: price, vatRateBasisPoints: 2000,
            calendarColor: color, isOnlineBookable: isOnlineBookable, isActive: isActive,
            createdAt: now, branchOverrides: overrides
        )
    }
}
