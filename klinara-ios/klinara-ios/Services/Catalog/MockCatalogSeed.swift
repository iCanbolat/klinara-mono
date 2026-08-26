import Foundation

/// Mock katalogun başlangıç verisi.
///
/// Gerçek bir medikal estetik merkezinin hizmet listesine benzemesi kasıtlı:
/// tasarım kararları (satır yüksekliği, uzun hizmet adının kırpılması, buffer'lı
/// hizmetin görünümü) ancak gerçekçi metinle sınanabilir.
enum MockCatalogSeed {

    static let categoryEpilasyon = "d1000000-0000-4000-8000-000000000001"
    static let categoryCilt = "d1000000-0000-4000-8000-000000000002"
    static let categoryEnjeksiyon = "d1000000-0000-4000-8000-000000000003"

    static let serviceLazerTumVucut = "e1000000-0000-4000-8000-000000000001"
    static let serviceLazerBolgesel = "e1000000-0000-4000-8000-000000000002"
    static let serviceHydrafacial = "e1000000-0000-4000-8000-000000000003"
    static let serviceKimyasalPeeling = "e1000000-0000-4000-8000-000000000004"
    static let serviceBotoks = "e1000000-0000-4000-8000-000000000005"
    static let serviceDolgu = "e1000000-0000-4000-8000-000000000006"

    static func categories(at now: Date) -> [ServiceCategory] {
        [
            ServiceCategory(
                id: categoryEpilasyon, tenantId: MockIDs.tenant, slug: "epilasyon",
                name: "Epilasyon", sortOrder: 0, isActive: true, createdAt: now
            ),
            ServiceCategory(
                id: categoryCilt, tenantId: MockIDs.tenant, slug: "cilt-bakimi",
                name: "Cilt Bakımı", sortOrder: 1, isActive: true, createdAt: now
            ),
            ServiceCategory(
                id: categoryEnjeksiyon, tenantId: MockIDs.tenant, slug: "enjeksiyon",
                name: "Enjeksiyon İşlemleri", sortOrder: 2, isActive: true, createdAt: now
            ),
        ]
    }

    static func services(at now: Date) -> [ClinicService] {
        [
            service(
                id: serviceLazerTumVucut, category: categoryEpilasyon,
                slug: "tum-vucut-lazer", name: "Tüm Vücut Lazer Epilasyon",
                description: "Buz başlıklı alexandrite lazer, tüm vücut seansı.",
                duration: 90, before: 10, after: 15, price: 250_000,
                color: "#7F9A76", at: now,
                overrides: [
                    // Bağdat Caddesi şubesi daha yeni cihazla çalışıyor: daha kısa, daha pahalı.
                    BranchServiceOverride(
                        id: MockIDs.uuid(), tenantId: MockIDs.tenant,
                        serviceId: serviceLazerTumVucut, branchId: MockIDs.branchBagdat,
                        durationMinutes: 75, bufferBeforeMinutes: nil, bufferAfterMinutes: nil,
                        priceMinor: 285_000, vatRateBasisPoints: nil,
                        isOnlineBookable: nil, isActive: nil, createdAt: now
                    )
                ]
            ),
            service(
                id: serviceLazerBolgesel, category: categoryEpilasyon,
                slug: "bolgesel-lazer", name: "Bölgesel Lazer Epilasyon",
                description: "Koltuk altı, bikini veya bacak bölgesi.",
                duration: 30, before: 5, after: 10, price: 90_000,
                color: "#9DB894", at: now
            ),
            service(
                id: serviceHydrafacial, category: categoryCilt,
                slug: "hydrafacial", name: "Hydrafacial",
                description: "Derin temizlik, peeling ve nemlendirme.",
                duration: 60, before: 5, after: 10, price: 180_000,
                color: "#5E7856", at: now
            ),
            service(
                id: serviceKimyasalPeeling, category: categoryCilt,
                slug: "kimyasal-peeling", name: "Kimyasal Peeling",
                description: nil,
                duration: 45, before: 5, after: 15, price: 140_000,
                color: "#A6483C", at: now, isOnlineBookable: false
            ),
            service(
                id: serviceBotoks, category: categoryEnjeksiyon,
                slug: "botoks-ust-yuz", name: "Botoks — Üst Yüz",
                description: "Alın, glabella ve kaz ayağı bölgesi.",
                duration: 30, before: 10, after: 10, price: 650_000,
                color: "#2E3532", at: now, isOnlineBookable: false
            ),
            service(
                id: serviceDolgu, category: categoryEnjeksiyon,
                slug: "dudak-dolgusu", name: "Dudak Dolgusu",
                description: "Hyaluronik asit, 1 ml.",
                duration: 45, before: 10, after: 15, price: 900_000,
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
