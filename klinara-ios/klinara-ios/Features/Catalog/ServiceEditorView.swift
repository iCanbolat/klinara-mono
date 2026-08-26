import SwiftUI

/// Hizmet oluşturma ve düzenleme formu.
struct ServiceEditorView: View {

    enum Target: Identifiable {
        case create
        case edit(ClinicService)

        var id: String {
            switch self {
            case .create: "create"
            case .edit(let service): service.id
            }
        }

        var existing: ClinicService? {
            if case .edit(let service) = self { return service }
            return nil
        }
    }

    let session: AppSession
    let target: Target

    @Environment(\.dismiss) private var dismiss
    @State private var form: ServiceForm
    @State private var error: APIError?

    private var store: CatalogStore { session.catalogStore }
    private var isReadOnly: Bool { !session.can(Permissions.serviceWrite) }
    private var fieldErrors: [String: String] { error?.fieldErrors ?? [:] }

    init(session: AppSession, target: Target) {
        self.session = session
        self.target = target
        _form = State(initialValue: ServiceForm(
            existing: target.existing,
            defaultCategoryId: session.catalogStore.catalog.categories
                .filter(\.isActive)
                .sorted { $0.sortOrder < $1.sortOrder }
                .first?.id
        ))
    }

    var body: some View {
        KlinaraFormScaffold(
            title: target.existing == nil ? "Yeni hizmet" : "Hizmeti düzenle",
            canSave: form.isValid,
            isDirty: form.isDirty,
            isReadOnly: isReadOnly,
            isSaving: store.isSaving,
            error: error,
            onSave: save
        ) {
            basicsSection
            timingSection
            pricingSection
            appearanceSection
            overridesSection
        }
    }

    // MARK: Bölümler

    private var basicsSection: some View {
        KlinaraFormSection(title: "Tanım") {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraTextField(
                    label: "Hizmet adı",
                    text: $form.name,
                    placeholder: "Tüm Vücut Lazer Epilasyon",
                    error: fieldErrors["name"],
                    autocapitalization: .words
                )
                .onChange(of: form.name) { _, newValue in form.nameDidChange(newValue) }

                KlinaraTextField(
                    label: "Kod (slug)",
                    text: $form.slug,
                    placeholder: "tum-vucut-lazer",
                    error: form.slugValidationMessage ?? fieldErrors["slug"]
                )
                .onChange(of: form.slug) { _, newValue in form.slugDidChange(newValue) }

                Picker("Kategori", selection: $form.categoryId) {
                    ForEach(activeCategories) { category in
                        Text(category.name).tag(category.id)
                    }
                }
                .pickerStyle(.menu)
                .tint(KlinaraColor.sageDeep)
                .klinaraText(.bodyM)

                KlinaraTextField(
                    label: "Açıklama",
                    text: $form.description,
                    placeholder: "İsteğe bağlı",
                    error: fieldErrors["description"],
                    autocapitalization: .sentences
                )
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private var timingSection: some View {
        KlinaraFormSection(
            title: "Süre",
            footnote: "Hazırlık ve temizlik payı takvimde bloke edilir ama müşteriye gösterilen saate dâhil değildir. Toplam: \(DurationFormat.format(minutes: form.occupiedMinutes))."
        ) {
            KlinaraStepperRow(
                label: "İşlem süresi",
                value: $form.durationMinutes,
                range: 5...1440,
                step: 5,
                isEnabled: !isReadOnly,
                format: DurationFormat.format(minutes:)
            )
            KlinaraDivider()
            KlinaraStepperRow(
                label: "Hazırlık payı",
                detail: "Randevudan önce",
                value: $form.bufferBeforeMinutes,
                range: 0...240,
                isEnabled: !isReadOnly
            )
            KlinaraDivider()
            KlinaraStepperRow(
                label: "Temizlik payı",
                detail: "Randevudan sonra",
                value: $form.bufferAfterMinutes,
                range: 0...240,
                isEnabled: !isReadOnly
            )
        }
    }

    private var pricingSection: some View {
        KlinaraFormSection(title: "Fiyat") {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraMoneyField(
                    label: "Fiyat",
                    amountMinor: $form.priceMinor,
                    error: fieldErrors["priceMinor"]
                )

                Picker("KDV oranı", selection: $form.vatRateBasisPoints) {
                    ForEach(VatRate.common, id: \.self) { rate in
                        Text(VatRate.format(basisPoints: rate)).tag(rate)
                    }
                }
                .pickerStyle(.segmented)
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private var appearanceSection: some View {
        KlinaraFormSection(title: "Görünüm ve yayın") {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                ColorSwatchPicker(label: "Takvim rengi", hex: $form.calendarColor)
            }
            .padding(KlinaraMetrics.md)

            KlinaraDivider()
            KlinaraToggleRow(
                label: "Online randevuya açık",
                detail: "Müşteriler bu hizmeti kendileri seçebilir",
                isOn: $form.isOnlineBookable,
                isEnabled: !isReadOnly
            )
            KlinaraDivider()
            KlinaraToggleRow(
                label: "Aktif",
                detail: "Pasif hizmet yeni randevularda seçilemez",
                isOn: $form.isActive,
                isEnabled: !isReadOnly
            )
        }
    }

    @ViewBuilder
    private var overridesSection: some View {
        if session.branches.count > 1 {
            KlinaraFormSection(
                title: "Şube farkları",
                footnote: "Boş bırakılan alanlar hizmetin genel değerini kullanır."
            ) {
                ForEach(Array(session.branches.enumerated()), id: \.element.id) { index, branch in
                    if index > 0 { KlinaraDivider() }
                    BranchOverrideEditor(
                        branch: branch,
                        override: overrideBinding(for: branch.id),
                        isReadOnly: isReadOnly
                    )
                }
            }
        }
    }

    /// Override satırları form sözlüğüne bağlanır; henüz kaydı olmayan bir
    /// şube için boş bir girdi üretilir ve boş kaldığı sürece gönderilmez.
    private func overrideBinding(for branchId: String) -> Binding<BranchServiceOverrideInput> {
        Binding(
            get: { form.overrides[branchId] ?? BranchServiceOverrideInput(branchId: branchId) },
            set: { form.overrides[branchId] = $0 }
        )
    }

    private var activeCategories: [ServiceCategory] {
        store.catalog.categories
            .filter { $0.isActive || $0.id == form.categoryId }
            .sorted { $0.sortOrder < $1.sortOrder }
    }

    // MARK: Kaydetme

    private func save() async {
        error = nil
        do {
            if let existing = target.existing {
                _ = try await store.updateService(id: existing.id, form.updateInput())
            } else {
                _ = try await store.createService(form.createInput())
            }
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}

/// Tek bir şube için override satırı.
private struct BranchOverrideEditor: View {

    let branch: BranchSummary
    @Binding var override: BranchServiceOverrideInput
    let isReadOnly: Bool

    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraMoneyField(
                    label: "Fiyat",
                    amountMinor: $override.priceMinor,
                    placeholder: "Genel fiyat",
                    footnote: "Boş bırakılırsa hizmetin genel fiyatı geçerli olur."
                )

                OptionalMinutesField(
                    label: "İşlem süresi",
                    minutes: $override.durationMinutes,
                    range: 5...1440
                )
            }
            .padding(.top, KlinaraMetrics.md)
            .disabled(isReadOnly)
        } label: {
            HStack {
                Text(branch.name)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoal)
                Spacer()
                if !override.isEmpty {
                    KlinaraBadge(text: "Özel", tone: .neutral)
                }
            }
        }
        .tint(KlinaraColor.charcoalMuted)
        .padding(KlinaraMetrics.md)
    }
}

/// "Belirtilmemiş" ile "0" arasındaki farkı koruyan dakika alanı.
///
/// Override'larda bu ayrım kritik: `nil` "hizmetin değerini kullan", `0` ise
/// "sıfır dakika". Sıradan bir `Stepper` ikisini ayırt edemez.
private struct OptionalMinutesField: View {

    let label: String
    @Binding var minutes: Int?
    var range: ClosedRange<Int> = 0...240

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            KlinaraToggleRow(
                label: label,
                detail: minutes == nil ? "Genel değer kullanılıyor" : nil,
                isOn: Binding(
                    get: { minutes != nil },
                    set: { minutes = $0 ? range.lowerBound : nil }
                )
            )

            if minutes != nil {
                KlinaraStepperRow(
                    label: "Süre",
                    value: Binding(get: { minutes ?? range.lowerBound }, set: { minutes = $0 }),
                    range: range,
                    format: DurationFormat.format(minutes:)
                )
            }
        }
    }
}
