import SwiftUI

/// İndirim oluşturma ve düzenleme.
///
/// Düzenlemede sunucu yalnız **dört alanı** kabul ediyor: ad, bitiş, kullanım
/// sınırı ve aktiflik. Kod, tür, değer ve kapsam kilitli — bunları değiştirmek,
/// bu indirimle daha önce kesilmiş kalemlerin ne indirimi olduğunu değiştirirdi.
struct DiscountEditorView: View {

    let session: AppSession
    var editing: Discount?

    @Environment(\.dismiss) private var dismiss

    @State private var code = ""
    @State private var name = ""
    @State private var kind: DiscountKind = .percent
    @State private var percentText = ""
    @State private var amountMinor: Int?
    @State private var scope: DiscountScope = .all
    @State private var scopeRefId: String?
    @State private var hasEndDate = false
    @State private var endsAt = Date().addingTimeInterval(30 * 86_400)
    @State private var hasLimit = false
    @State private var maxRedemptions = 100
    @State private var isActive = true
    @State private var error: APIError?
    @State private var didLoad = false

    private var store: DiscountStore { session.discountStore }
    private var catalogStore: CatalogStore { session.catalogStore }
    private var definitionStore: PackageDefinitionStore { session.packageDefinitionStore }

    private var isEditing: Bool { editing != nil }

    private var value: Int? {
        switch kind {
        case .percent: CommissionRuleForm.basisPoints(fromPercentText: percentText)
        case .amount: amountMinor
        }
    }

    private var isValid: Bool {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        if isEditing { return !store.isSaving }
        guard let value, value > 0 else { return false }
        if kind == .percent, value > 10_000 { return false }
        if scope != .all, scopeRefId == nil { return false }
        return !store.isSaving
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped {
                        ErrorBanner(error: error)
                    }

                    nameCard
                    if isEditing { lockedCard } else { valueCard; scopeCard }
                    limitsCard
                    if isEditing { activeCard }
                    submitButton
                    if isEditing { deleteButton }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle(isEditing ? "İndirimi düzenle" : "İndirim")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .task {
                await catalogStore.load()
                await definitionStore.load()
                loadOnce()
            }
            .overlay {
                if store.isSaving { AuthLoadingOverlay(message: "İndirim kaydediliyor…") }
            }
        }
        .tint(KlinaraColor.sage)
    }

    // MARK: Bölümler

    private var nameCard: some View {
        KlinaraCard(
            title: "Tanım",
            footnote: isEditing ? nil : "Kod verilmezse indirim yalnız elle seçilebilir."
        ) {
            KlinaraTextField(
                label: "İndirim adı",
                text: $name,
                placeholder: "Yaz kampanyası",
                error: error?.fieldErrors["name"],
                autocapitalization: .sentences
            )
            .padding(KlinaraMetrics.md)

            if !isEditing {
                KlinaraDivider()
                KlinaraTextField(
                    label: "Kampanya kodu",
                    text: $code,
                    placeholder: "YAZ2026",
                    error: error?.fieldErrors["code"],
                    autocapitalization: .characters
                )
                .padding(KlinaraMetrics.md)
            }
        }
    }

    /// Değiştirilemeyen alanlar okunur olarak gösteriliyor: gizlemek
    /// kullanıcıyı "hangi indirimi düzenliyorum?" sorusuyla baş başa bırakırdı.
    @ViewBuilder
    private var lockedCard: some View {
        if let editing {
            KlinaraCard(
                title: "Sabit alanlar",
                footnote: "Kod, tür, değer ve kapsam sonradan değiştirilemez; geçmiş kalemler bu indirime göre kesildi."
            ) {
                KlinaraRow(label: "Kod", value: editing.code ?? "—")
                KlinaraDivider()
                KlinaraRow(label: "Tür", value: editing.kind.turkishName)
                KlinaraDivider()
                KlinaraRow(label: "Değer", value: editing.valueLabel, isMonospaced: true)
                KlinaraDivider()
                KlinaraRow(label: "Kapsam", value: editing.scope.turkishName)
            }
        }
    }

    private var valueCard: some View {
        KlinaraCard(title: "Değer") {
            KlinaraSegmentedPicker(
                options: DiscountKind.allCases,
                selection: $kind,
                title: { $0.turkishName }
            )
            .padding(KlinaraMetrics.md)

            KlinaraDivider()
            switch kind {
            case .percent:
                KlinaraTextField(
                    label: "Yüzde",
                    text: $percentText,
                    placeholder: "15",
                    error: error?.fieldErrors["value"],
                    keyboardType: .decimalPad
                )
                .padding(KlinaraMetrics.md)
            case .amount:
                KlinaraMoneyField(
                    label: "İndirim tutarı",
                    amountMinor: $amountMinor,
                    error: error?.fieldErrors["value"]
                )
                .padding(KlinaraMetrics.md)
            }
        }
    }

    private var scopeCard: some View {
        KlinaraCard(title: "Kapsam") {
            ForEach(Array(DiscountScope.allCases.enumerated()), id: \.element.id) { index, option in
                if index > 0 { KlinaraDivider() }
                Button {
                    scope = option
                    scopeRefId = nil
                } label: {
                    KlinaraRow(label: option.turkishName) {
                        Image(systemName: scope == option ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 18))
                            .foregroundStyle(scope == option ? KlinaraColor.sageDeep : KlinaraColor.border)
                    }
                }
                .buttonStyle(.plain)
            }

            if scope != .all {
                KlinaraDivider()
                scopeReferencePicker
            }
        }
    }

    @ViewBuilder
    private var scopeReferencePicker: some View {
        switch scope {
        case .service:
            KlinaraSearchablePicker(
                title: "Hizmet",
                options: catalogStore.catalog.services.filter(\.isActive),
                label: \.name,
                detail: { Money.format(minor: $0.priceMinor) },
                isSelected: { $0.id == scopeRefId },
                onSelect: { scopeRefId = $0.id },
                searchPrompt: "Hizmet ara",
                emptyMessage: "Aramanızla eşleşen hizmet yok."
            )
        case .package:
            KlinaraSearchablePicker(
                title: "Paket",
                options: definitionStore.definitions,
                label: \.name,
                detail: { Money.format(minor: $0.totalPriceMinor) },
                isSelected: { $0.id == scopeRefId },
                onSelect: { scopeRefId = $0.id },
                searchPrompt: "Paket ara",
                emptyMessage: "Aramanızla eşleşen paket yok."
            )
        case .all:
            EmptyView()
        }
    }

    private var limitsCard: some View {
        KlinaraCard(title: "Sınırlar") {
            KlinaraToggleRow(
                label: "Bitiş tarihi",
                detail: "Kapalıysa indirim süresizdir.",
                isOn: $hasEndDate
            )
            if hasEndDate {
                KlinaraDivider()
                DatePicker("Bitiş", selection: $endsAt, displayedComponents: .date)
                    .datePickerStyle(.compact)
                    .padding(KlinaraMetrics.md)
            }

            KlinaraDivider()
            KlinaraToggleRow(
                label: "Kullanım sınırı",
                detail: "Kapalıysa sınırsız kullanılabilir.",
                isOn: $hasLimit
            )
            if hasLimit {
                KlinaraDivider()
                KlinaraStepperRow(
                    label: "Azami kullanım",
                    value: $maxRedemptions,
                    range: 1...100_000,
                    step: 10,
                    format: { "\($0)" }
                )
            }
        }
    }

    private var activeCard: some View {
        KlinaraCard(title: "Durum") {
            KlinaraToggleRow(
                label: "Aktif",
                detail: "Pasif indirim yeni kalemlerde seçilemez; geçmiş kalemler etkilenmez.",
                isOn: $isActive
            )
        }
    }

    private var submitButton: some View {
        KlinaraButton(
            title: isEditing ? "Değişikliği kaydet" : "İndirimi oluştur",
            kind: .primary,
            icon: "checkmark",
            isLoading: store.isSaving,
            isEnabled: isValid
        ) {
            Task { await submit() }
        }
    }

    private var deleteButton: some View {
        KlinaraButton(
            title: "İndirimi sil",
            kind: .tertiary,
            icon: "trash",
            isEnabled: !store.isSaving
        ) {
            Task { await delete() }
        }
    }

    // MARK: Eylemler

    private func loadOnce() {
        guard !didLoad else { return }
        didLoad = true
        guard let editing else { return }
        code = editing.code ?? ""
        name = editing.name
        kind = editing.kind
        scope = editing.scope
        scopeRefId = editing.scopeRefId
        isActive = editing.isActive
        if let end = editing.endsAt {
            hasEndDate = true
            endsAt = end
        }
        if let max = editing.maxRedemptions {
            hasLimit = true
            maxRedemptions = max
        }
    }

    private func submit() async {
        error = nil
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if let editing {
                _ = try await store.update(
                    id: editing.id,
                    version: editing.version,
                    UpdateDiscountInput(
                        name: trimmedName,
                        endsAt: hasEndDate ? KlinaraCoding.timestamp(endsAt) : nil,
                        maxRedemptions: hasLimit ? maxRedemptions : nil,
                        isActive: isActive
                    )
                )
            } else {
                let trimmedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
                _ = try await store.create(
                    CreateDiscountInput(
                        code: trimmedCode.isEmpty ? nil : trimmedCode,
                        name: trimmedName,
                        kind: kind,
                        value: value ?? 0,
                        scope: scope,
                        scopeRefId: scope == .all ? nil : scopeRefId,
                        startsAt: nil,
                        endsAt: hasEndDate ? KlinaraCoding.timestamp(endsAt) : nil,
                        maxRedemptions: hasLimit ? maxRedemptions : nil
                    )
                )
            }
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }

    private func delete() async {
        guard let editing else { return }
        error = nil
        do {
            try await store.delete(id: editing.id, version: editing.version)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
