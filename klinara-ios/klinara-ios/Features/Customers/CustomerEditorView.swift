import SwiftUI

/// Müşteri oluşturma / düzenleme sayfası.
struct CustomerEditorView: View {

    enum Target: Identifiable {
        case create
        case edit(Customer)

        var id: String {
            switch self {
            case .create: "create"
            case .edit(let customer): customer.id
            }
        }

        var existing: Customer? {
            if case .edit(let customer) = self { return customer }
            return nil
        }
    }

    let session: AppSession
    let target: Target
    /// Randevu akışı içinde açıldığında yeni müşteriyi seçime almak için.
    var onSaved: ((Customer) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var form: CustomerForm
    @State private var error: APIError?

    private var store: CustomerStore { session.customerStore }
    private var isReadOnly: Bool { !session.can(Permissions.customerWrite) }
    private var fieldErrors: [String: String] { error?.fieldErrors ?? [:] }

    init(session: AppSession, target: Target, onSaved: ((Customer) -> Void)? = nil) {
        self.session = session
        self.target = target
        self.onSaved = onSaved
        _form = State(initialValue: CustomerForm(existing: target.existing, clock: session.clock))
    }

    var body: some View {
        KlinaraFormScaffold(
            title: target.existing == nil ? "Yeni müşteri" : "Müşteriyi düzenle",
            canSave: form.isValid,
            isDirty: form.isDirty,
            isReadOnly: isReadOnly,
            isSaving: store.isSaving,
            error: error,
            onSave: save
        ) {
            identitySection
            contactSection
            addressSection
            tagSection
            notesSection
        }
        .task { await store.loadTags() }
    }

    private var identitySection: some View {
        KlinaraFormSection(title: "Kimlik") {
            KlinaraTextField(
                label: "Ad soyad",
                text: $form.fullName,
                placeholder: "Ayşe Yılmaz",
                error: fieldErrors["fullName"],
                autocapitalization: .words
            )
            .padding(KlinaraMetrics.md)
            .disabled(isReadOnly)

            KlinaraDivider()

            KlinaraToggleRow(
                label: "Doğum tarihi",
                detail: "Yaş bazlı kontrendikasyon kontrolleri için.",
                isOn: $form.hasBirthDate,
                isEnabled: !isReadOnly
            )

            if form.hasBirthDate {
                KlinaraDivider()
                DatePicker(
                    "Doğum tarihi",
                    selection: $form.birthDate,
                    in: ...Date(),
                    displayedComponents: .date
                )
                // Doğum tarihi çıplak bir takvim günü; cihaz saatinde değil
                // şube saatinde kurulmalı ki gece yarısı bir gün kaymasın.
                .environment(\.timeZone, session.clock.timeZone)
                .klinaraText(.bodyM)
                .padding(KlinaraMetrics.md)
                .disabled(isReadOnly)
            }

            KlinaraDivider()

            Picker("Cinsiyet", selection: $form.gender) {
                Text("Belirtilmedi").tag(CustomerGender?.none)
                ForEach(CustomerGender.allCases) { value in
                    Text(value.turkishName).tag(CustomerGender?.some(value))
                }
            }
            .pickerStyle(.menu)
            .tint(KlinaraColor.sageDeep)
            .klinaraText(.bodyM)
            .padding(KlinaraMetrics.md)
            .disabled(isReadOnly)
        }
    }

    private var contactSection: some View {
        KlinaraFormSection(
            title: "İletişim",
            footnote: "Telefon numarası klinik içinde tekildir; "
                + "aynı numarayla ikinci bir kart açılamaz."
        ) {
            PhoneNumberField(
                label: "Telefon",
                e164: $form.phone,
                error: fieldErrors["phone"]
            )
            .padding(KlinaraMetrics.md)
            .disabled(isReadOnly)

            KlinaraDivider()

            KlinaraTextField(
                label: "E-posta",
                text: $form.email,
                placeholder: "ayse@ornek.com",
                error: form.emailValidationMessage ?? fieldErrors["email"],
                keyboardType: .emailAddress
            )
            .padding(KlinaraMetrics.md)
            .disabled(isReadOnly)
        }
    }

    private var addressSection: some View {
        KlinaraFormSection(
            title: "Adres ve geliş kaynağı",
            footnote: "Geliş kaynağı hangi kanalın müşteri getirdiğini gösterir."
        ) {
            KlinaraTextField(
                label: "Adres",
                text: $form.addressLine,
                placeholder: "Bağdat Cad. No: 120 D: 5",
                error: fieldErrors["addressLine"],
                autocapitalization: .words
            )
            .padding(KlinaraMetrics.md)
            .disabled(isReadOnly)

            KlinaraDivider()

            KlinaraTextField(
                label: "İlçe",
                text: $form.district,
                placeholder: "Kadıköy",
                error: fieldErrors["district"],
                autocapitalization: .words
            )
            .padding(KlinaraMetrics.md)
            .disabled(isReadOnly)

            KlinaraDivider()

            KlinaraTextField(
                label: "İl",
                text: $form.city,
                placeholder: "İstanbul",
                error: fieldErrors["city"],
                autocapitalization: .words
            )
            .padding(KlinaraMetrics.md)
            .disabled(isReadOnly)

            KlinaraDivider()

            KlinaraTextField(
                label: "Posta kodu",
                text: $form.postalCode,
                placeholder: "34710",
                error: fieldErrors["postalCode"],
                keyboardType: .numberPad
            )
            .padding(KlinaraMetrics.md)
            .disabled(isReadOnly)

            KlinaraDivider()

            Picker("Geliş kaynağı", selection: $form.source) {
                Text("Belirtilmedi").tag(CustomerSource?.none)
                ForEach(CustomerSource.allCases) { value in
                    Text(value.turkishName).tag(CustomerSource?.some(value))
                }
            }
            .pickerStyle(.menu)
            .tint(KlinaraColor.sageDeep)
            .klinaraText(.bodyM)
            .padding(KlinaraMetrics.md)
            .disabled(isReadOnly)
        }
    }

    /// Etiketler ayrı bir uca yazılıyor (`PUT /customers/:id/tags`) ve bu uç
    /// **var olan** bir kart istiyor. Yeni kayıtta bu yüzden önce kart açılıyor,
    /// etiketler ikinci istekle bağlanıyor.
    @ViewBuilder
    private var tagSection: some View {
        KlinaraFormSection(
            title: "Etiketler",
            footnote: store.tags.isEmpty
                ? "Henüz etiket tanımlanmamış. Yönetim → Müşteri etiketleri."
                : nil
        ) {
            if store.tags.isEmpty {
                KlinaraRow(label: "Etiket yok")
            } else {
                KlinaraChipGrid(
                    options: store.tags,
                    title: { $0.name },
                    isSelected: { form.tagIds.contains($0.id) },
                    isEnabled: { _ in !isReadOnly },
                    onTap: { tag in
                        if form.tagIds.contains(tag.id) {
                            form.tagIds.remove(tag.id)
                        } else {
                            form.tagIds.insert(tag.id)
                        }
                    }
                )
                .padding(KlinaraMetrics.md)
            }
        }
    }

    private var notesSection: some View {
        KlinaraFormSection(title: "Not") {
            KlinaraTextField(
                label: "Not",
                text: $form.notes,
                placeholder: "Örn. cilt hassasiyeti var",
                error: fieldErrors["notes"],
                autocapitalization: .sentences
            )
            .padding(KlinaraMetrics.md)
            .disabled(isReadOnly)
        }
    }

    private func save() async {
        error = nil
        do {
            var saved: Customer
            let isNew = target.existing == nil
            if let existing = target.existing {
                saved = try await store.update(id: existing.id, form.updateInput())
            } else {
                saved = try await store.create(form.createInput())
            }

            // Etiketler ayrı uçta. Kart AÇILDIKTAN sonra yazılıyor: yeni kayıtta
            // henüz kimlik yoktu. Değişmediyse istek hiç atılmaz.
            if form.tagsChanged || (isNew && !form.tagIds.isEmpty) {
                saved = try await store.replaceTags(
                    customerId: saved.id,
                    tagIds: Array(form.tagIds)
                )
            }

            onSaved?(saved)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
