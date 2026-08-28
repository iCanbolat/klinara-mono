import SwiftUI

/// Kalan hakkın başka bir müşteriye devri.
///
/// Devir bir **taşıma**dır, kopyalama değil: kaynak paketten `transfer_out`,
/// hedefte açılan yeni paketten `transfer_in` kaydı çıkar ve iki tarafın
/// toplamı korunur. Devredilemez satılmış paketler burada hiç açılmaz.
struct PackageTransferSheet: View {

    let session: AppSession
    let store: CustomerPackagesStore
    let package: CustomerPackage

    @Environment(\.dismiss) private var dismiss

    @State private var targetCustomer: Customer?
    @State private var searchText = ""
    @State private var isFullTransfer = true
    @State private var sessionsByItem: [String: Int] = [:]
    @State private var reason = ""
    @State private var error: APIError?
    @State private var idempotencyKey = UUID().uuidString

    private var customerStore: CustomerStore { session.customerStore }
    private var fieldErrors: [String: String] { error?.fieldErrors ?? [:] }

    private var transferableItems: [CustomerPackageItem] {
        package.items
            .filter { $0.remainingSessions > 0 }
            .sorted { $0.sortOrder < $1.sortOrder }
    }

    private var selectedItems: [TransferItemInput] {
        transferableItems.compactMap { item in
            let sessions = sessionsByItem[item.id] ?? 0
            guard sessions > 0 else { return nil }
            return TransferItemInput(customerPackageItemId: item.id, sessions: sessions)
        }
    }

    private var input: TransferPackageInput {
        TransferPackageInput(
            targetCustomerId: targetCustomer?.id ?? "",
            items: isFullTransfer ? nil : selectedItems,
            reason: reason
        )
    }

    var body: some View {
        KlinaraFormScaffold(
            title: "Paketi devret",
            saveTitle: "Devret",
            canSave: input.isValid && (isFullTransfer || !selectedItems.isEmpty),
            isDirty: true,
            isSaving: store.isSaving,
            error: error,
            onSave: save
        ) {
            targetSection
            scopeSection
            if !isFullTransfer { itemsSection }
            reasonSection
        }
        .task { await customerStore.load() }
    }

    // MARK: Bölümler

    private var targetSection: some View {
        KlinaraFormSection(
            title: "Hedef müşteri",
            footnote: "Paket aynı müşteriye devredilemez."
        ) {
            KlinaraSearchablePicker(
                title: "Müşteri",
                options: candidates,
                label: { $0.fullName },
                detail: { $0.phone },
                isSelected: { $0.id == targetCustomer?.id },
                onSelect: { targetCustomer = $0 },
                searchPrompt: "Müşteri ara",
                emptyMessage: "Eşleşen müşteri yok."
            )
        }
    }

    /// Kaynak müşteri listeden düşürülür: sunucu da reddediyor ama seçilebilen
    /// bir seçenek sunup sonra reddetmek kullanıcıyı boşuna yorar.
    private var candidates: [Customer] {
        customerStore.state.value?
            .filter { $0.id != package.customerId }
            .sorted { $0.fullName.localizedStandardCompare($1.fullName) == .orderedAscending }
            ?? []
    }

    private var scopeSection: some View {
        KlinaraFormSection(title: "Kapsam") {
            KlinaraToggleRow(
                label: "Tüm kalan hakkı devret",
                detail: "\(package.remainingSessions) seans",
                isOn: $isFullTransfer
            )
        }
    }

    private var itemsSection: some View {
        KlinaraFormSection(title: "Kalemler") {
            ForEach(Array(transferableItems.enumerated()), id: \.element.id) { index, item in
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

    private var reasonSection: some View {
        KlinaraFormSection(title: "Gerekçe") {
            KlinaraTextEditor(
                label: "Devir nedeni",
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
            _ = try await store.transfer(
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
