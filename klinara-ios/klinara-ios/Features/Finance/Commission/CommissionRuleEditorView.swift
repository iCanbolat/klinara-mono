import SwiftUI

/// Prim kuralı oluşturma ve düzenleme.
///
/// Düzenlemede kapsam, matrah ve tetikleyici **kilitli** görünür: sunucu onları
/// kabul etmiyor ve düzenlenebilir gibi göstermek, kaydettikten sonra
/// değişmediğini fark eden bir kullanıcı demekti.
struct CommissionRuleEditorView: View {

    let session: AppSession
    let store: CommissionStore
    var editing: CommissionRule?

    @Environment(\.dismiss) private var dismiss

    @State private var form: CommissionRuleForm?
    @State private var error: APIError?
    @State private var isDeleting = false

    private var catalogStore: CatalogStore { session.catalogStore }
    private var staffStore: StaffStore { session.staffStore }
    private var definitionStore: PackageDefinitionStore { session.packageDefinitionStore }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped {
                        ErrorBanner(error: error)
                    }

                    if let form {
                        nameCard(form)
                        scopeCard(form)
                        staffCard(form)
                        calcCard(form)
                        basisCard(form)
                        priorityCard(form)
                        if form.isEditing { activeCard(form) }
                        submitButton(form)
                        if form.isEditing { deleteButton(form) }
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle(editing == nil ? "Prim kuralı" : "Kuralı düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .task {
                if form == nil {
                    form = editing.map(CommissionRuleForm.init(editing:)) ?? CommissionRuleForm()
                }
                await catalogStore.load()
                await staffStore.load()
                await definitionStore.load()
            }
            .overlay {
                if store.isSaving { AuthLoadingOverlay(message: "Kural kaydediliyor…") }
            }
        }
        .tint(KlinaraColor.sage)
    }

    // MARK: Bölümler

    private func nameCard(_ form: CommissionRuleForm) -> some View {
        KlinaraCard(title: "Kural") {
            KlinaraTextField(
                label: "Kural adı",
                text: Binding(get: { form.name }, set: { form.name = $0 }),
                placeholder: "Genel prim %10",
                error: error?.fieldErrors["name"],
                autocapitalization: .sentences
            )
            .padding(KlinaraMetrics.md)
        }
    }

    @ViewBuilder
    private func scopeCard(_ form: CommissionRuleForm) -> some View {
        KlinaraCard(title: "Kapsam", footnote: scopeFootnote(form)) {
            if form.isEditing {
                KlinaraRow(
                    label: form.scope.turkishName,
                    detail: "Kapsam sonradan değiştirilemez; geçmiş tahakkuklar bu kurala göre doğdu."
                )
            } else {
                ForEach(Array(CommissionScope.allCases.enumerated()), id: \.element.id) { index, option in
                    if index > 0 { KlinaraDivider() }
                    Button {
                        form.scope = option
                        form.scopeRefId = nil
                    } label: {
                        KlinaraRow(
                            label: option.turkishName,
                            detail: option.accruesToday ? nil : "Henüz prim üretmiyor"
                        ) {
                            Image(systemName: form.scope == option ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 18))
                                .foregroundStyle(
                                    form.scope == option ? KlinaraColor.sageDeep : KlinaraColor.border
                                )
                        }
                    }
                    .buttonStyle(.plain)
                }

                if form.scope.needsReference {
                    KlinaraDivider()
                    scopeReferencePicker(form)
                }
            }
        }
    }

    private func scopeFootnote(_ form: CommissionRuleForm) -> String? {
        form.scope.accruesToday
            ? nil
            : "Bu kapsam kaydedilir ama tahakkuk çözümleyicisi henüz yalnız randevu hizmetleri üzerinden yürüyor."
    }

    @ViewBuilder
    private func scopeReferencePicker(_ form: CommissionRuleForm) -> some View {
        switch form.scope {
        case .service:
            KlinaraSearchablePicker(
                title: "Hizmet",
                options: catalogStore.catalog.services.filter(\.isActive),
                label: \.name,
                detail: { Money.format(minor: $0.priceMinor) },
                isSelected: { $0.id == form.scopeRefId },
                onSelect: { form.scopeRefId = $0.id },
                searchPrompt: "Hizmet ara",
                emptyMessage: "Aramanızla eşleşen hizmet yok."
            )
        case .package:
            KlinaraSearchablePicker(
                title: "Paket",
                options: definitionStore.definitions,
                label: \.name,
                detail: { Money.format(minor: $0.totalPriceMinor) },
                isSelected: { $0.id == form.scopeRefId },
                onSelect: { form.scopeRefId = $0.id },
                searchPrompt: "Paket ara",
                emptyMessage: "Aramanızla eşleşen paket yok."
            )
        case .product:
            // Ürün kataloğu Faz 6 kapsamı dışında; seçilecek bir liste yok.
            KlinaraRow(
                label: "Ürün seçilemiyor",
                detail: "Ürün kataloğu henüz yok; ürün kapsamlı kural şimdilik kurulamaz."
            )
        case .global:
            EmptyView()
        }
    }

    private func staffCard(_ form: CommissionRuleForm) -> some View {
        KlinaraCard(
            title: "Personel",
            footnote: "Personel seçilirse bu kural o personel için kapsamlı kuralı EZER."
        ) {
            if form.isEditing {
                KlinaraRow(
                    label: form.staffProfileId.flatMap { staffStore.profile(id: $0)?.userFullName }
                        ?? "Tüm personel",
                    detail: "Personel eşlemesi sonradan değiştirilemez."
                )
            } else {
                Button {
                    form.staffProfileId = nil
                } label: {
                    KlinaraRow(label: "Tüm personel") {
                        Image(systemName: form.staffProfileId == nil ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 18))
                            .foregroundStyle(
                                form.staffProfileId == nil ? KlinaraColor.sageDeep : KlinaraColor.border
                            )
                    }
                }
                .buttonStyle(.plain)

                ForEach(staffStore.profiles.filter(\.isActive)) { profile in
                    KlinaraDivider()
                    Button {
                        form.staffProfileId = profile.id
                    } label: {
                        KlinaraRow(label: profile.userFullName, detail: profile.title) {
                            Image(systemName: form.staffProfileId == profile.id ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 18))
                                .foregroundStyle(
                                    form.staffProfileId == profile.id
                                        ? KlinaraColor.sageDeep
                                        : KlinaraColor.border
                                )
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// Yüzde alanı kullanıcıya **yüzde** gösterir; sunucuya baz puan gider.
    /// Ekranda 1000 yazan bir alan, %1000 prim tanımlamaya davetiye olurdu.
    private func calcCard(_ form: CommissionRuleForm) -> some View {
        KlinaraCard(title: "Hesaplama") {
            KlinaraSegmentedPicker(
                options: CommissionCalcKind.allCases,
                selection: Binding(get: { form.calcKind }, set: { form.calcKind = $0 }),
                title: { $0.turkishName }
            )
            .padding(KlinaraMetrics.md)
            .disabled(form.isEditing)
            .opacity(form.isEditing ? 0.5 : 1)

            KlinaraDivider()
            switch form.calcKind {
            case .percent:
                KlinaraTextField(
                    label: "Yüzde",
                    text: Binding(get: { form.percentText }, set: { form.percentText = $0 }),
                    placeholder: "10",
                    error: error?.fieldErrors["value"],
                    keyboardType: .decimalPad
                )
                .padding(KlinaraMetrics.md)
            case .fixed:
                KlinaraMoneyField(
                    label: "Sabit tutar",
                    amountMinor: Binding(
                        get: { form.fixedAmountMinor },
                        set: { form.fixedAmountMinor = $0 }
                    ),
                    error: error?.fieldErrors["value"]
                )
                .padding(KlinaraMetrics.md)
            }
        }
    }

    private func basisCard(_ form: CommissionRuleForm) -> some View {
        KlinaraCard(title: "Matrah ve tetikleyici", footnote: triggerFootnote(form)) {
            if form.isEditing {
                KlinaraRow(label: "Matrah", value: form.basis.turkishName)
                KlinaraDivider()
                KlinaraRow(label: "Tetikleyici", value: form.triggerOn.turkishName)
            } else {
                ForEach(Array(CommissionBasis.allCases.enumerated()), id: \.element.id) { index, option in
                    if index > 0 { KlinaraDivider() }
                    Button {
                        form.basis = option
                    } label: {
                        KlinaraRow(label: option.turkishName, detail: option.explanation) {
                            Image(systemName: form.basis == option ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 18))
                                .foregroundStyle(
                                    form.basis == option ? KlinaraColor.sageDeep : KlinaraColor.border
                                )
                        }
                    }
                    .buttonStyle(.plain)
                }

                KlinaraDivider()
                KlinaraSegmentedPicker(
                    options: CommissionTrigger.allCases,
                    selection: Binding(get: { form.triggerOn }, set: { form.triggerOn = $0 }),
                    title: { $0.turkishName }
                )
                .padding(KlinaraMetrics.md)
            }
        }
    }

    private func triggerFootnote(_ form: CommissionRuleForm) -> String {
        form.triggerOn.explanation
    }

    private func priorityCard(_ form: CommissionRuleForm) -> some View {
        KlinaraCard(
            title: "Öncelik",
            footnote: "Aynı kapsam ve personelde ikinci bir aktif kural aynı önceliği alamaz — çözüm belirsiz olamaz."
        ) {
            KlinaraStepperRow(
                label: "Öncelik",
                detail: "Yüksek öncelik önce uygulanır.",
                value: Binding(get: { form.priority }, set: { form.priority = $0 }),
                range: 0...1000,
                step: 10,
                format: { "\($0)" }
            )
        }
    }

    private func activeCard(_ form: CommissionRuleForm) -> some View {
        KlinaraCard(title: "Durum") {
            KlinaraToggleRow(
                label: "Aktif",
                detail: "Pasif kural tahakkuk üretmez ama geçmiş kayıtlar durur.",
                isOn: Binding(get: { form.isActive }, set: { form.isActive = $0 })
            )
        }
    }

    private func submitButton(_ form: CommissionRuleForm) -> some View {
        KlinaraButton(
            title: form.isEditing ? "Değişikliği kaydet" : "Kuralı oluştur",
            kind: .primary,
            icon: "checkmark",
            isLoading: store.isSaving,
            isEnabled: form.isValid && !store.isSaving
        ) {
            Task { await submit(form) }
        }
    }

    private func deleteButton(_ form: CommissionRuleForm) -> some View {
        KlinaraButton(
            title: "Kuralı sil",
            kind: .tertiary,
            icon: "trash",
            isLoading: isDeleting,
            isEnabled: !isDeleting && !store.isSaving
        ) {
            Task { await delete(form) }
        }
    }

    // MARK: Eylemler

    private func submit(_ form: CommissionRuleForm) async {
        error = nil
        do {
            if let id = form.editingId, let version = form.editingVersion {
                _ = try await store.updateRule(id: id, version: version, form.updateInput())
            } else {
                _ = try await store.createRule(form.createInput())
            }
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }

    private func delete(_ form: CommissionRuleForm) async {
        guard let id = form.editingId, let version = form.editingVersion else { return }
        error = nil
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await store.deleteRule(id: id, version: version)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
