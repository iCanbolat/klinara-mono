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
            notesSection
        }
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
            let saved: Customer
            if let existing = target.existing {
                saved = try await store.update(id: existing.id, form.updateInput())
            } else {
                saved = try await store.create(form.createInput())
            }
            onSaved?(saved)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
