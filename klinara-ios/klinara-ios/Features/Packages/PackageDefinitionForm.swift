import SwiftUI

/// ``PackageDefinitionEditorView``'in düzenleme durumu.
///
/// ``ServiceForm`` kalıbı: gözlemlenebilir olmayan bir değer tipi, `@State`
/// içinde yaşar, `isValid`/`isDirty`'yi kendi hesaplar ve iki ayrı wire
/// gövdesini (`Create`/`Update`) kendi kurar.
struct PackageDefinitionForm {

    /// Kalemin form içindeki hâli. Sunucu gövdesi yalnız `serviceId` + `quantity`
    /// taşır ama ekranın ada ve liste fiyatına da ihtiyacı var — indirim
    /// önizlemesi bunlar olmadan hesaplanamaz.
    struct Item: Identifiable, Equatable {
        let id = UUID()
        var serviceId: String
        var serviceName: String
        var unitListPriceMinor: Int
        var quantity: Int

        var listTotalMinor: Int { unitListPriceMinor * quantity }
    }

    var slug: String
    var name: String
    var description: String
    var totalPriceMinor: Int?
    var branchId: String?
    /// `nil` **süresiz** paket demektir; `0` değil.
    var validityDays: Int?
    var isTransferable: Bool
    var isOnlineSellable: Bool
    var isActive: Bool
    var items: [Item]

    private var slugIsCustom: Bool
    private let original: Snapshot
    /// Düzenlemede slug ve şube kilitlidir: ikisi de satılmış paketlerin
    /// izini etkiler ve sunucu `PATCH` gövdesinde ikisini de kabul etmez.
    let isEditing: Bool

    private struct Snapshot: Equatable {
        var slug: String
        var name: String
        var description: String
        var totalPriceMinor: Int?
        var branchId: String?
        var validityDays: Int?
        var isTransferable: Bool
        var isOnlineSellable: Bool
        var isActive: Bool
        var items: [Item]
    }

    init(existing: PackageDefinition?) {
        slug = existing?.slug ?? ""
        name = existing?.name ?? ""
        description = existing?.description ?? ""
        totalPriceMinor = existing?.totalPriceMinor
        branchId = existing?.branchId
        validityDays = existing?.validityDays
        isTransferable = existing?.isTransferable ?? true
        isOnlineSellable = existing?.isOnlineSellable ?? false
        isActive = existing?.isActive ?? true
        items = (existing?.items ?? []).sorted { $0.sortOrder < $1.sortOrder }.map {
            Item(
                serviceId: $0.serviceId,
                serviceName: $0.serviceName,
                unitListPriceMinor: $0.unitListPriceMinor,
                quantity: $0.quantity
            )
        }
        slugIsCustom = existing != nil
        isEditing = existing != nil

        original = Snapshot(
            slug: slug, name: name, description: description,
            totalPriceMinor: totalPriceMinor, branchId: branchId,
            validityDays: validityDays, isTransferable: isTransferable,
            isOnlineSellable: isOnlineSellable, isActive: isActive, items: items
        )
    }

    // MARK: Türetilmiş

    private var current: Snapshot {
        Snapshot(
            slug: slug, name: name, description: description,
            totalPriceMinor: totalPriceMinor, branchId: branchId,
            validityDays: validityDays, isTransferable: isTransferable,
            isOnlineSellable: isOnlineSellable, isActive: isActive, items: items
        )
    }

    var isDirty: Bool { current != original }

    var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && Slug.isValid(slug)
            && totalPriceMinor != nil
            && !items.isEmpty
            && items.allSatisfy { $0.quantity > 0 }
            && !hasDuplicateService
    }

    var slugValidationMessage: String? {
        guard !slug.isEmpty, !Slug.isValid(slug) else { return nil }
        return "Yalnız küçük harf, rakam ve tire; 3-50 karakter."
    }

    /// Sunucu aynı hizmetin iki kez verilmesini reddediyor; kullanıcıya `400`
    /// yerine kırmızı bir satır göstermek daha dürüst.
    var hasDuplicateService: Bool {
        Set(items.map(\.serviceId)).count != items.count
    }

    var totalSessions: Int { items.reduce(0) { $0 + $1.quantity } }

    /// Kalemlerin **güncel** katalog fiyatları toplamı. Satış fiyatıyla farkı
    /// kullanıcıya indirimi gösterir; sunucudaki `listPriceMinor` ile aynı hesap.
    var listPriceMinor: Int { items.reduce(0) { $0 + $1.listTotalMinor } }

    var discountMinor: Int? {
        guard let totalPriceMinor else { return nil }
        let diff = listPriceMinor - totalPriceMinor
        return diff > 0 ? diff : nil
    }

    // MARK: Düzenleme

    mutating func nameDidChange(_ newValue: String) {
        guard !slugIsCustom else { return }
        slug = Slug.make(from: newValue)
    }

    mutating func slugDidChange(_ newValue: String) {
        guard !slugIsCustom, newValue != Slug.make(from: name) else { return }
        slugIsCustom = true
    }

    mutating func add(service: ClinicService, in branchId: String?) {
        guard !items.contains(where: { $0.serviceId == service.id }) else { return }
        let effective = service.effective(in: branchId)
        items.append(
            Item(
                serviceId: service.id,
                serviceName: service.name,
                unitListPriceMinor: effective.priceMinor,
                quantity: 1
            )
        )
    }

    mutating func remove(_ item: Item) {
        items.removeAll { $0.id == item.id }
    }

    // MARK: Sunucu gövdeleri

    private var wireItems: [PackageDefinitionItemInput] {
        items.map { PackageDefinitionItemInput(serviceId: $0.serviceId, quantity: $0.quantity) }
    }

    private var trimmedDescription: String {
        description.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func createInput() -> CreatePackageDefinitionInput {
        CreatePackageDefinitionInput(
            slug: slug,
            name: name.trimmingCharacters(in: .whitespaces),
            description: trimmedDescription.isEmpty ? nil : trimmedDescription,
            totalPriceMinor: totalPriceMinor ?? 0,
            branchId: branchId,
            validityDays: validityDays,
            isTransferable: isTransferable,
            isOnlineSellable: isOnlineSellable,
            isActive: isActive,
            items: wireItems
        )
    }

    /// Kalem listesi **her zaman** gönderilir: sunucu verilen listeyle
    /// tamamen değiştiriyor ve formda kalemler zaten tam hâlleriyle duruyor.
    func updateInput() -> UpdatePackageDefinitionInput {
        UpdatePackageDefinitionInput(
            name: name.trimmingCharacters(in: .whitespaces),
            description: .text(trimmedDescription),
            totalPriceMinor: totalPriceMinor,
            // "Süresiz" seçildiyse alan TEMİZLENİR; gönderilmemesi eski süreyi
            // olduğu gibi bırakırdı.
            validityDays: validityDays.map { Nullable.set($0) } ?? .clear,
            isTransferable: isTransferable,
            isOnlineSellable: isOnlineSellable,
            isActive: isActive,
            items: wireItems
        )
    }
}
