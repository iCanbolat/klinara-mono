import SwiftUI

/// Şube oluşturma / düzenleme.
///
/// - Kod (slug) addan önerilir; kullanıcı alana dokunduğu anda öneri durur.
///   Oluşturulduktan sonra değişmez ve salt okunur gösterilir.
/// - Pasife almak geri alınabilir ama etkisi büyük: kaydederken ayrıca onay
///   sorulur. Aktif etmek sorulmaz.
/// - `PATCH` yalnız değişen alanları gönderir; boşaltılan telefon/adres
///   `null` ile temizlenir.
struct BranchFormView: View {

    let session: AppSession
    /// `nil` = oluşturma.
    let branch: BranchDetail?
    let onSaved: (BranchDetail) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var slug = ""
    @State private var slugTouched = false
    @State private var timezone = "Europe/Istanbul"
    @State private var phone = ""
    @State private var address = ""
    @State private var isActive = true
    @State private var error: APIError?
    @State private var isSaving = false
    @State private var confirmsDeactivation = false
    @State private var didLoad = false

    private var isCreate: Bool { branch == nil }

    private var isDirty: Bool {
        guard let branch else { return !name.isEmpty || !slug.isEmpty }
        return !updateInput(for: branch).isEmpty
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && (!isCreate || BranchSlug.isValid(slug))
            && isDirty
    }

    var body: some View {
        KlinaraFormScaffold(
            title: isCreate ? "Yeni şube" : "Şubeyi düzenle",
            saveTitle: isCreate ? "Oluştur" : "Kaydet",
            canSave: canSave,
            isDirty: isDirty,
            isSaving: isSaving,
            error: error,
            onSave: requestSave
        ) {
            KlinaraFormSection(title: "Şube") {
                VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                    KlinaraTextField(
                        label: "Şube adı",
                        text: $name,
                        placeholder: "İzmir Alsancak",
                        error: error?.fieldErrors["name"],
                        autocapitalization: .words
                    )
                    .onChange(of: name) { _, newValue in
                        if isCreate, !slugTouched { slug = BranchSlug.suggest(from: newValue) }
                    }

                    if isCreate {
                        KlinaraTextField(
                            label: "Şube kodu",
                            text: Binding(
                                get: { slug },
                                set: { slug = $0.lowercased(); slugTouched = true }
                            ),
                            placeholder: "izmir-alsancak",
                            error: error?.fieldErrors["slug"] ?? slugHint
                        )
                    } else if let branch {
                        KlinaraRow(label: "Şube kodu", value: branch.slug, isMonospaced: true)
                    }
                }
                .padding(KlinaraMetrics.md)
            }

            KlinaraFormSection(
                title: "İletişim",
                footnote: "Saat dilimi randevu ve çalışma saatlerinin hangi saate göre tutulacağını belirler."
            ) {
                VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                    Picker("Saat dilimi", selection: $timezone) {
                        ForEach(timeZones, id: \.self) { zone in
                            Text(zone).tag(zone)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(KlinaraColor.sageDeep)
                    .klinaraText(.bodyM)

                    KlinaraTextField(
                        label: "Telefon",
                        text: $phone,
                        placeholder: "+90 212 000 00 00",
                        error: error?.fieldErrors["phone"],
                        textContentType: .telephoneNumber,
                        keyboardType: .phonePad
                    )
                    KlinaraTextField(
                        label: "Adres",
                        text: $address,
                        placeholder: "Cadde, no, ilçe",
                        error: error?.fieldErrors["address"],
                        autocapitalization: .sentences
                    )
                }
                .padding(KlinaraMetrics.md)
            }

            if !isCreate {
                KlinaraFormSection(
                    footnote: "Pasif şubede yeni randevu alınmaz ve şube menüsünde görünmez; geçmiş kayıtlar korunur."
                ) {
                    KlinaraToggleRow(label: "Aktif", isOn: $isActive)
                }
            }
        }
        .onAppear(perform: fill)
        .confirmationDialog(
            "Şube pasife alınsın mı?",
            isPresented: $confirmsDeactivation,
            titleVisibility: .visible
        ) {
            Button("Pasife al", role: .destructive) { Task { await save() } }
            Button("Vazgeç", role: .cancel) {}
        } message: {
            Text("Bu şubede yeni randevu alınamaz. Mevcut randevular, müşteriler ve raporlar korunur; istediğiniz zaman yeniden aktif edebilirsiniz.")
        }
    }

    /// Geçersiz kod için yardım satırı — sunucu hatası yokken de yazarken görünür.
    private var slugHint: String? {
        guard !slug.isEmpty, !BranchSlug.isValid(slug) else { return nil }
        return "3–50 karakter; küçük harf, rakam ve tire."
    }

    private var timeZones: [String] {
        var zones = ["Europe/Istanbul"]
        if !zones.contains(timezone) { zones.append(timezone) }
        return zones + TimeZone.knownTimeZoneIdentifiers.filter { !zones.contains($0) }
    }

    private func fill() {
        guard !didLoad else { return }
        didLoad = true
        guard let branch else { return }
        name = branch.name
        slug = branch.slug
        slugTouched = true
        timezone = branch.timezone
        phone = branch.phone ?? ""
        address = branch.address ?? ""
        isActive = branch.isActive
    }

    private func updateInput(for branch: BranchDetail) -> UpdateBranchInput {
        var input = UpdateBranchInput()
        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        if trimmedName != branch.name { input.name = trimmedName }
        if timezone != branch.timezone { input.timezone = timezone }
        if phone.trimmingCharacters(in: .whitespaces) != (branch.phone ?? "") { input.phone = .text(phone) }
        if address.trimmingCharacters(in: .whitespaces) != (branch.address ?? "") { input.address = .text(address) }
        if isActive != branch.isActive { input.isActive = isActive }
        return input
    }

    private func requestSave() async {
        if let branch, branch.isActive, !isActive {
            confirmsDeactivation = true
        } else {
            await save()
        }
    }

    private func save() async {
        error = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let result: BranchDetail
            if let branch {
                result = try await session.services.branches.update(id: branch.id, updateInput(for: branch))
            } else {
                let trimmedPhone = phone.trimmingCharacters(in: .whitespaces)
                let trimmedAddress = address.trimmingCharacters(in: .whitespaces)
                result = try await session.services.branches.create(CreateBranchInput(
                    slug: slug,
                    name: name.trimmingCharacters(in: .whitespaces),
                    timezone: timezone,
                    phone: trimmedPhone.isEmpty ? nil : trimmedPhone,
                    address: trimmedAddress.isEmpty ? nil : trimmedAddress
                ))
            }
            onSaved(result)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
