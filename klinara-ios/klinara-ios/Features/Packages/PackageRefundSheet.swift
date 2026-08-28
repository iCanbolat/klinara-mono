import SwiftUI

/// Paket iadesi — tam ya da kısmi.
///
/// Tutar **satış anındaki tahsisten** hesaplanır, güncel katalog fiyatından
/// değil: kampanyalı satılan bir paketin iadesi liste fiyatından yapılırsa
/// klinik taşımadığı bir borcu öder.
///
/// Kasa hareketi yoktur; iade `pending` bir yükümlülük yazar ve tahsilat
/// tarafı Faz 6.2'de bağlanır. Kullanıcı bunu ekranda görmeli.
struct PackageRefundSheet: View {

    let session: AppSession
    let store: CustomerPackagesStore
    let package: CustomerPackage

    @Environment(\.dismiss) private var dismiss

    @State private var isFullRefund = true
    @State private var sessionsByItem: [String: Int] = [:]
    @State private var reason = ""
    @State private var error: APIError?
    @State private var idempotencyKey = UUID().uuidString

    private var fieldErrors: [String: String] { error?.fieldErrors ?? [:] }

    private var refundableItems: [CustomerPackageItem] {
        package.items
            .filter { $0.remainingSessions > 0 }
            .sorted { $0.sortOrder < $1.sortOrder }
    }

    /// Tam iadede `items` **gönderilmez**: sunucu "tüm kalan hak" anlamına
    /// gelen bu boşluğu kendi hesaplıyor ve arada yarış olmuyor.
    private var input: RefundPackageInput {
        RefundPackageInput(items: isFullRefund ? nil : selectedItems, reason: reason)
    }

    private var selectedItems: [RefundItemInput] {
        refundableItems.compactMap { item in
            let sessions = sessionsByItem[item.id] ?? 0
            guard sessions > 0 else { return nil }
            return RefundItemInput(customerPackageItemId: item.id, sessions: sessions)
        }
    }

    var body: some View {
        KlinaraFormScaffold(
            title: "Paketi iade et",
            saveTitle: "İade et",
            canSave: input.isValid && (isFullRefund || !selectedItems.isEmpty),
            isDirty: true,
            isSaving: store.isSaving,
            error: error,
            onSave: save
        ) {
            scopeSection
            if !isFullRefund { itemsSection }
            amountSection
            reasonSection
        }
    }

    private var scopeSection: some View {
        KlinaraFormSection(title: "Kapsam") {
            KlinaraToggleRow(
                label: "Tüm kalan hakkı iade et",
                detail: "\(package.remainingSessions) seans",
                isOn: $isFullRefund
            )
        }
    }

    private var itemsSection: some View {
        KlinaraFormSection(title: "Kalemler") {
            ForEach(Array(refundableItems.enumerated()), id: \.element.id) { index, item in
                if index > 0 { KlinaraDivider() }
                KlinaraStepperRow(
                    label: item.serviceName,
                    detail: "Kalan \(item.remainingSessions) seans",
                    value: Binding(
                        get: { sessionsByItem[item.id] ?? 0 },
                        set: { sessionsByItem[item.id] = $0 }
                    ),
                    range: 0...item.remainingSessions,
                    step: 1,
                    format: { "\($0) seans" }
                )
            }
        }
    }

    /// Tutar önizlemesi sunucudakiyle aynı kuralı uygular: kalem tahsisinin
    /// seans başına payı. Sunucu son sözü söyler, ama kullanıcı ne kadar iade
    /// edeceğini basmadan önce görmeli.
    private var amountSection: some View {
        KlinaraFormSection(
            title: "Tutar",
            footnote: "Kasa hareketi oluşturulmaz: borç `bekliyor` olarak kaydedilir, tahsilat Faz 6'da bağlanacak."
        ) {
            KlinaraRow(
                label: "Tahmini iade",
                value: Money.format(minor: estimatedAmountMinor, currency: package.currency),
                detail: "Satış anındaki tahsisten hesaplanır"
            )
        }
    }

    private var estimatedAmountMinor: Int {
        let lines: [(item: CustomerPackageItem, sessions: Int)] = isFullRefund
            ? refundableItems.map { ($0, $0.remainingSessions) }
            : refundableItems.map { ($0, sessionsByItem[$0.id] ?? 0) }
        return lines.reduce(0) { total, line in
            guard line.item.quantityTotal > 0 else { return total }
            let unit = line.item.itemTotalMinor / line.item.quantityTotal
            return total + unit * line.sessions
        }
    }

    private var reasonSection: some View {
        KlinaraFormSection(title: "Gerekçe") {
            KlinaraTextEditor(
                label: "İade nedeni",
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
            _ = try await store.refund(
                packageId: package.id,
                version: package.version,
                input,
                idempotencyKey: idempotencyKey
            )
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
