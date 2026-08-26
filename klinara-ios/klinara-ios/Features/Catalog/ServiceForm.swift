import SwiftUI

/// ``ServiceEditorView``'in düzenleme durumu.
///
/// Formun kendi tipi olmasının sebebi: sunucuya giden `Create`/`Update`
/// gövdeleri farklı (biri zorunlu alanlı, diğeri tamamen opsiyonel) ama
/// kullanıcının doldurduğu alanlar aynı. Görünümün iki ayrı gövdeyi elle
/// kurması, bir alanın yalnız birinde güncellenmesiyle biterdi.
struct ServiceForm {

    var name: String
    var slug: String
    var categoryId: String
    var description: String
    var durationMinutes: Int
    var bufferBeforeMinutes: Int
    var bufferAfterMinutes: Int
    var priceMinor: Int?
    var vatRateBasisPoints: Int
    var calendarColor: String?
    var isOnlineBookable: Bool
    var isActive: Bool
    var overrides: [String: BranchServiceOverrideInput]

    /// Kullanıcı slug'ı elle düzenlediyse addan türetmeyi bırakırız —
    /// yazdığı kodu her tuş vuruşunda ezmek düpedüz sinir bozucu olur.
    private var slugIsCustom: Bool
    private let original: Snapshot

    private struct Snapshot: Equatable {
        var name: String
        var slug: String
        var categoryId: String
        var description: String
        var durationMinutes: Int
        var bufferBeforeMinutes: Int
        var bufferAfterMinutes: Int
        var priceMinor: Int?
        var vatRateBasisPoints: Int
        var calendarColor: String?
        var isOnlineBookable: Bool
        var isActive: Bool
        var overrides: [String: BranchServiceOverrideInput]
    }

    init(existing: ClinicService?, defaultCategoryId: String?) {
        name = existing?.name ?? ""
        slug = existing?.slug ?? ""
        categoryId = existing?.categoryId ?? defaultCategoryId ?? ""
        description = existing?.description ?? ""
        durationMinutes = existing?.durationMinutes ?? 60
        bufferBeforeMinutes = existing?.bufferBeforeMinutes ?? 0
        bufferAfterMinutes = existing?.bufferAfterMinutes ?? 0
        priceMinor = existing?.priceMinor
        vatRateBasisPoints = existing?.vatRateBasisPoints ?? 2000
        calendarColor = existing?.calendarColor
        isOnlineBookable = existing?.isOnlineBookable ?? true
        isActive = existing?.isActive ?? true
        slugIsCustom = existing != nil

        var mapped: [String: BranchServiceOverrideInput] = [:]
        for override in existing?.branchOverrides ?? [] {
            mapped[override.branchId] = BranchServiceOverrideInput(
                branchId: override.branchId,
                durationMinutes: override.durationMinutes,
                bufferBeforeMinutes: override.bufferBeforeMinutes,
                bufferAfterMinutes: override.bufferAfterMinutes,
                priceMinor: override.priceMinor,
                vatRateBasisPoints: override.vatRateBasisPoints,
                isOnlineBookable: override.isOnlineBookable,
                isActive: override.isActive
            )
        }
        overrides = mapped

        original = Snapshot(
            name: name, slug: slug, categoryId: categoryId, description: description,
            durationMinutes: durationMinutes,
            bufferBeforeMinutes: bufferBeforeMinutes, bufferAfterMinutes: bufferAfterMinutes,
            priceMinor: priceMinor, vatRateBasisPoints: vatRateBasisPoints,
            calendarColor: calendarColor, isOnlineBookable: isOnlineBookable,
            isActive: isActive, overrides: overrides
        )
    }

    // MARK: Türetilmiş

    var occupiedMinutes: Int {
        bufferBeforeMinutes + durationMinutes + bufferAfterMinutes
    }

    var isDirty: Bool { current != original }

    var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && Slug.isValid(slug)
            && !categoryId.isEmpty
            && priceMinor != nil
    }

    var slugValidationMessage: String? {
        guard !slug.isEmpty, !Slug.isValid(slug) else { return nil }
        return "Yalnız küçük harf, rakam ve tire; 3-50 karakter."
    }

    private var current: Snapshot {
        Snapshot(
            name: name, slug: slug, categoryId: categoryId, description: description,
            durationMinutes: durationMinutes,
            bufferBeforeMinutes: bufferBeforeMinutes, bufferAfterMinutes: bufferAfterMinutes,
            priceMinor: priceMinor, vatRateBasisPoints: vatRateBasisPoints,
            calendarColor: calendarColor, isOnlineBookable: isOnlineBookable,
            isActive: isActive, overrides: overrides
        )
    }

    // MARK: Düzenleme

    mutating func nameDidChange(_ newValue: String) {
        guard !slugIsCustom else { return }
        slug = Slug.make(from: newValue)
    }

    /// Kullanıcı slug'ı elle değiştirdiyse addan türetmeyi bırak.
    mutating func slugDidChange(_ newValue: String) {
        guard !slugIsCustom, newValue != Slug.make(from: name) else { return }
        slugIsCustom = true
    }

    // MARK: Sunucu gövdeleri

    private var cleanedOverrides: [BranchServiceOverrideInput]? {
        let filled = overrides.values.filter { !$0.isEmpty }
        // Boş liste ile `nil` farklı: `nil` "override'lara dokunma",
        // boş liste "hepsini kaldır" demek. Kullanıcı hepsini temizlediyse
        // ikincisini kastediyor.
        return Array(filled)
    }

    func createInput() -> CreateServiceInput {
        CreateServiceInput(
            categoryId: categoryId,
            slug: slug,
            name: name.trimmingCharacters(in: .whitespaces),
            description: description.isEmpty ? nil : description,
            durationMinutes: durationMinutes,
            bufferBeforeMinutes: bufferBeforeMinutes,
            bufferAfterMinutes: bufferAfterMinutes,
            priceMinor: priceMinor ?? 0,
            vatRateBasisPoints: vatRateBasisPoints,
            calendarColor: calendarColor,
            isOnlineBookable: isOnlineBookable,
            isActive: isActive,
            branchOverrides: cleanedOverrides
        )
    }

    func updateInput() -> UpdateServiceInput {
        UpdateServiceInput(
            categoryId: categoryId,
            slug: slug,
            name: name.trimmingCharacters(in: .whitespaces),
            description: description.isEmpty ? nil : description,
            durationMinutes: durationMinutes,
            bufferBeforeMinutes: bufferBeforeMinutes,
            bufferAfterMinutes: bufferAfterMinutes,
            priceMinor: priceMinor,
            vatRateBasisPoints: vatRateBasisPoints,
            calendarColor: calendarColor,
            isOnlineBookable: isOnlineBookable,
            isActive: isActive,
            branchOverrides: cleanedOverrides
        )
    }
}
