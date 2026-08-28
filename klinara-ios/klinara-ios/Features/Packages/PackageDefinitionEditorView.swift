import SwiftUI

/// Paket tanımı oluşturma ve düzenleme formu.
///
/// Kalem listesi formun **kalbi**: bir paket birden çok hizmet içerebildiği
/// için (10 lazer + 2 bakım) kalemler tek satırlık bir adet alanına
/// indirilemez. Satış fiyatı kalemlerin liste toplamından bağımsızdır ve
/// aradaki fark indirim olarak canlı gösterilir.
struct PackageDefinitionEditorView: View {

    enum Target: Identifiable {
        case create
        case edit(PackageDefinition)

        var id: String {
            switch self {
            case .create: "create"
            case .edit(let definition): definition.id
            }
        }

        var existing: PackageDefinition? {
            if case .edit(let definition) = self { return definition }
            return nil
        }
    }

    let session: AppSession
    let target: Target

    @Environment(\.dismiss) private var dismiss
    @State private var form: PackageDefinitionForm
    @State private var error: APIError?
    @State private var isPickingService = false

    private var store: PackageDefinitionStore { session.packageDefinitionStore }
    private var isReadOnly: Bool { !session.can(Permissions.packageWrite) }
    private var fieldErrors: [String: String] { error?.fieldErrors ?? [:] }

    init(session: AppSession, target: Target) {
        self.session = session
        self.target = target
        _form = State(initialValue: PackageDefinitionForm(existing: target.existing))
    }

    var body: some View {
        KlinaraFormScaffold(
            title: target.existing == nil ? "Yeni paket" : "Paketi düzenle",
            canSave: form.isValid,
            isDirty: form.isDirty,
            isReadOnly: isReadOnly,
            isSaving: store.isSaving,
            error: error,
            onSave: save
        ) {
            basicsSection
            itemsSection
            pricingSection
            rulesSection
        }
        .sheet(isPresented: $isPickingService) {
            servicePicker
        }
        .task { await session.catalogStore.load() }
    }

    // MARK: Bölümler

    private var basicsSection: some View {
        KlinaraFormSection(title: "Tanım") {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraTextField(
                    label: "Paket adı",
                    text: $form.name,
                    placeholder: "10 Seans Lazer + 2 Bakım",
                    error: fieldErrors["name"],
                    autocapitalization: .words
                )
                .onChange(of: form.name) { _, newValue in form.nameDidChange(newValue) }

                KlinaraTextField(
                    label: "Kod (slug)",
                    text: $form.slug,
                    placeholder: "lazer-10-seans",
                    error: form.slugValidationMessage ?? fieldErrors["slug"]
                )
                .onChange(of: form.slug) { _, newValue in form.slugDidChange(newValue) }
                // Slug satılmış paketlerin izini taşıyor; sunucu `PATCH`
                // gövdesinde kabul de etmiyor.
                .disabled(form.isEditing)

                KlinaraTextEditor(
                    label: "Açıklama",
                    text: $form.description,
                    placeholder: "İsteğe bağlı",
                    error: fieldErrors["description"],
                    minHeight: 90
                )
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private var itemsSection: some View {
        KlinaraFormSection(
            title: "Kalemler",
            footnote: form.hasDuplicateService
                ? "Aynı hizmet iki kez eklenemez."
                : "Kalan hak KALEM bazında tutulur: 10 lazer + 2 bakım satılan bir pakette bakım hakkı lazer için kullanılamaz."
        ) {
            if form.items.isEmpty {
                KlinaraRow(label: "Henüz kalem yok", detail: "En az bir hizmet ekleyin")
            }

            ForEach(Array(form.items.enumerated()), id: \.element.id) { index, item in
                if index > 0 { KlinaraDivider() }
                itemRow(index: index, item: item)
            }

            if !isReadOnly {
                KlinaraDivider()
                Button {
                    isPickingService = true
                } label: {
                    Label("Hizmet ekle", systemImage: "plus")
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.sageDeep)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(KlinaraMetrics.md)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func itemRow(index: Int, item: PackageDefinitionForm.Item) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            KlinaraStepperRow(
                label: item.serviceName,
                detail: "\(Money.format(minor: item.unitListPriceMinor)) × \(item.quantity) = \(Money.format(minor: item.listTotalMinor))",
                value: $form.items[index].quantity,
                range: 1...1000,
                step: 1,
                isEnabled: !isReadOnly,
                format: { "\($0) seans" }
            )

            if !isReadOnly {
                Button(role: .destructive) {
                    form.remove(item)
                } label: {
                    Label("Kalemi kaldır", systemImage: "trash")
                        .klinaraText(.bodyM)
                        .font(.footnote)
                }
                .buttonStyle(.plain)
                .foregroundStyle(KlinaraColor.danger)
                .padding(.horizontal, KlinaraMetrics.md)
                .padding(.bottom, KlinaraMetrics.sm)
            }
        }
    }

    private var pricingSection: some View {
        KlinaraFormSection(
            title: "Fiyat",
            footnote: priceFootnote
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraMoneyField(
                    label: "Satış fiyatı",
                    amountMinor: $form.totalPriceMinor,
                    error: fieldErrors["totalPriceMinor"]
                )
                .disabled(isReadOnly)
            }
            .padding(KlinaraMetrics.md)
        }
    }

    /// İndirim canlı hesaplanır: kullanıcı fiyatı yazarken kalemlerin liste
    /// toplamıyla arasındaki farkı görmezse kampanyayı körlemesine kurar.
    private var priceFootnote: String {
        let list = "Kalemlerin katalog toplamı: \(Money.format(minor: form.listPriceMinor))"
        guard let discount = form.discountMinor else { return list }
        return "\(list) · İndirim: \(Money.format(minor: discount))"
    }

    private var rulesSection: some View {
        KlinaraFormSection(
            title: "Kurallar",
            footnote: "Tanım değişiklikleri SATILMIŞ paketleri etkilemez: satış anındaki snapshot geçerlidir."
        ) {
            KlinaraToggleRow(
                label: "Süreli paket",
                detail: form.validityDays.map { "Satıştan itibaren \($0) gün" }
                    ?? "Kapalıysa paket süresizdir",
                isOn: Binding(
                    get: { form.validityDays != nil },
                    // "Süresiz" ile "0 gün" aynı şey değil: kapatınca alan
                    // temizlenir, açınca makul bir varsayılana döner.
                    set: { form.validityDays = $0 ? (form.validityDays ?? 365) : nil }
                ),
                isEnabled: !isReadOnly
            )

            if form.validityDays != nil {
                KlinaraDivider()
                KlinaraStepperRow(
                    label: "Geçerlilik",
                    value: Binding(
                        get: { form.validityDays ?? 365 },
                        set: { form.validityDays = $0 }
                    ),
                    range: 1...3650,
                    step: 30,
                    isEnabled: !isReadOnly,
                    format: { "\($0) gün" }
                )
            }

            KlinaraDivider()
            KlinaraToggleRow(
                label: "Devredilebilir",
                detail: "Kalan hak başka bir müşteriye aktarılabilir",
                isOn: $form.isTransferable,
                isEnabled: !isReadOnly
            )
            KlinaraDivider()
            KlinaraToggleRow(
                label: "Online satışa açık",
                isOn: $form.isOnlineSellable,
                isEnabled: !isReadOnly
            )
            KlinaraDivider()
            KlinaraToggleRow(
                label: "Aktif",
                detail: "Pasif paket satılamaz, satılmışlar etkilenmez",
                isOn: $form.isActive,
                isEnabled: !isReadOnly
            )
        }
    }

    // MARK: Hizmet seçici

    private var servicePicker: some View {
        NavigationStack {
            KlinaraSearchablePicker(
                title: "Hizmet ekle",
                options: selectableServices,
                label: { $0.name },
                detail: { service in
                    Money.format(minor: service.effective(in: session.selectedBranchId).priceMinor)
                },
                isSelected: { service in form.items.contains { $0.serviceId == service.id } },
                onSelect: { service in
                    form.add(service: service, in: session.selectedBranchId)
                    isPickingService = false
                },
                searchPrompt: "Hizmet ara",
                emptyMessage: "Eklenebilecek aktif hizmet yok."
            )
            .navigationTitle("Hizmet ekle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Kapat") { isPickingService = false }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
        }
        .tint(KlinaraColor.sage)
    }

    private var selectableServices: [ClinicService] {
        session.catalogStore.catalog.services
            .filter(\.isActive)
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    // MARK: Kaydetme

    private func save() async {
        error = nil
        do {
            if let existing = target.existing {
                _ = try await store.update(
                    id: existing.id,
                    version: existing.version,
                    form.updateInput()
                )
            } else {
                _ = try await store.create(form.createInput())
            }
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
