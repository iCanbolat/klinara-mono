import SwiftUI

/// Kalan hakkı manuel düzeltme.
///
/// **Gerekçe zorunludur** ve bu sunucuda, hatta veritabanında zorlanıyor:
/// düzeltme deftere `manual_adjustment` olarak iz bırakır ve iz gerekçesiz
/// olursa "neden 6 değil 5?" sorusu yine cevapsız kalırdı.
struct PackageAdjustSheet: View {

    let session: AppSession
    let store: CustomerPackagesStore
    let package: CustomerPackage

    @Environment(\.dismiss) private var dismiss

    /// `customerPackageItemId` → delta. Sıfırlar gönderilmez.
    @State private var deltas: [String: Int] = [:]
    @State private var reason = ""
    @State private var error: APIError?

    private var fieldErrors: [String: String] { error?.fieldErrors ?? [:] }

    private var items: [AdjustItemInput] {
        package.items
            .sorted { $0.sortOrder < $1.sortOrder }
            .compactMap { item in
                let delta = deltas[item.id] ?? 0
                guard delta != 0 else { return nil }
                return AdjustItemInput(customerPackageItemId: item.id, delta: delta)
            }
    }

    private var input: AdjustPackageInput {
        AdjustPackageInput(items: items, reason: reason)
    }

    var body: some View {
        KlinaraFormScaffold(
            title: "Kalan hakkı düzelt",
            saveTitle: "Uygula",
            canSave: input.isValid,
            isDirty: !items.isEmpty || !reason.isEmpty,
            isSaving: store.isSaving,
            error: error,
            onSave: save
        ) {
            itemsSection
            reasonSection
        }
    }

    private var itemsSection: some View {
        KlinaraFormSection(
            title: "Kalemler",
            footnote: "Pozitif değer hak ekler, negatif düşer. Kalan hak eksiye inemez — sunucu reddeder."
        ) {
            ForEach(Array(package.items.sorted { $0.sortOrder < $1.sortOrder }.enumerated()), id: \.element.id) { index, item in
                if index > 0 { KlinaraDivider() }
                KlinaraStepperRow(
                    label: item.serviceName,
                    detail: detail(for: item),
                    value: Binding(
                        get: { deltas[item.id] ?? 0 },
                        set: { deltas[item.id] = $0 }
                    ),
                    // Kalan hakkı eksiye düşürecek adımı hiç sunmuyoruz;
                    // basılabilen ama daima 409 dönen bir düğme sinir bozucu.
                    range: (-item.remainingSessions)...item.quantityTotal,
                    step: 1,
                    format: { $0 > 0 ? "+\($0)" : "\($0)" }
                )
            }
        }
    }

    private func detail(for item: CustomerPackageItem) -> String {
        let delta = deltas[item.id] ?? 0
        let target = item.remainingSessions + delta
        guard delta != 0 else { return "Kalan \(item.remainingSessions)" }
        return "Kalan \(item.remainingSessions) → \(target)"
    }

    private var reasonSection: some View {
        KlinaraFormSection(title: "Gerekçe") {
            KlinaraTextEditor(
                label: "Neden düzeltiliyor?",
                text: $reason,
                placeholder: "En az \(AdjustPackageInput.minimumReasonLength) karakter",
                error: fieldErrors["reason"],
                minHeight: 90
            )
            .padding(KlinaraMetrics.md)
        }
    }

    private func save() async {
        error = nil
        do {
            try await store.adjust(packageId: package.id, version: package.version, input)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
