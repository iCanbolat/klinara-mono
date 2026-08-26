import SwiftUI

/// Personel profili oluşturma.
///
/// Profil **mevcut bir kullanıcıya** bağlanır (`CreateStaffProfileDto.userId`):
/// personel önce davetle hesap sahibi olur, sonra profili açılır. Bu yüzden
/// form bir kullanıcı seçimiyle başlar.
struct StaffCreateView: View {

    let session: AppSession

    @Environment(\.dismiss) private var dismiss

    @State private var candidates: LoadState<[UserProfile]> = .loading
    @State private var selectedUserId: String?
    @State private var title = ""
    @State private var specialties: [String] = []
    @State private var calendarColor: String?
    @State private var primaryBranchId: String?
    @State private var isVisibleOnline = true
    @State private var error: APIError?

    private var store: StaffStore { session.staffStore }

    var body: some View {
        KlinaraFormScaffold(
            title: "Yeni personel",
            saveTitle: "Oluştur",
            canSave: selectedUserId != nil,
            isDirty: selectedUserId != nil || !title.isEmpty,
            isSaving: store.isSaving,
            error: error,
            onSave: save
        ) {
            userSection
            if selectedUserId != nil { profileSection }
        }
        .task { await loadCandidates() }
    }

    @ViewBuilder
    private var userSection: some View {
        switch candidates {
        case .loading:
            KlinaraFormSection(title: "Kullanıcı") {
                HStack {
                    ProgressView().tint(KlinaraColor.sage)
                    Text("Kullanıcılar yükleniyor…")
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
                .padding(KlinaraMetrics.md)
            }

        case .failed(let failure):
            ErrorBanner(error: failure, onRetry: { Task { await loadCandidates() } })

        case .loaded(let users):
            if users.isEmpty {
                KlinaraFormSection(
                    title: "Kullanıcı",
                    footnote: "Profili olmayan kullanıcı kalmadı. Yeni bir personel için önce davet gönderin."
                ) {
                    KlinaraRow(label: "Uygun kullanıcı yok")
                }
            } else {
                KlinaraFormSection(title: "Kullanıcı") {
                    ForEach(Array(users.enumerated()), id: \.element.id) { index, user in
                        if index > 0 { KlinaraDivider() }
                        Button {
                            selectedUserId = user.id
                        } label: {
                            KlinaraRow(label: user.fullName, detail: user.email) {
                                if selectedUserId == user.id {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(KlinaraColor.sageDeep)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var profileSection: some View {
        KlinaraFormSection(
            title: "Profil",
            footnote: "Hizmet yetkinlikleri profil oluşturulduktan sonra atanır."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraTextField(
                    label: "Unvan",
                    text: $title,
                    placeholder: "Lazer Uygulayıcısı",
                    error: error?.fieldErrors["title"],
                    autocapitalization: .words
                )

                KlinaraTagField(label: "Uzmanlıklar", tags: $specialties)
                ColorSwatchPicker(label: "Takvim rengi", hex: $calendarColor)

                Picker("Birincil şube", selection: $primaryBranchId) {
                    Text("Belirtilmedi").tag(String?.none)
                    ForEach(session.branches) { branch in
                        Text(branch.name).tag(Optional(branch.id))
                    }
                }
                .pickerStyle(.menu)
                .tint(KlinaraColor.sageDeep)
                .klinaraText(.bodyM)
            }
            .padding(KlinaraMetrics.md)

            KlinaraDivider()
            KlinaraToggleRow(label: "Online sayfada görünsün", isOn: $isVisibleOnline)
        }
    }

    private func loadCandidates() async {
        candidates = .loading
        do {
            await store.load()
            let existing = Set(store.profiles.map(\.userId))
            // Zaten profili olan kullanıcı listede görünmez: sunucu ikinci
            // profili `CONFLICT` ile reddeder, bunu kullanıcıya hata olarak
            // göstermek yerine baştan engelliyoruz.
            let users = try await session.services.users.users()
            candidates = .loaded(users.filter { !existing.contains($0.id) })
        } catch {
            candidates = .failed(error as? APIError ?? .network)
        }
    }

    private func save() async {
        guard let selectedUserId else { return }
        error = nil
        do {
            _ = try await store.create(CreateStaffProfileInput(
                userId: selectedUserId,
                primaryBranchId: primaryBranchId,
                title: title.isEmpty ? nil : title,
                specialties: specialties,
                calendarColor: calendarColor,
                isVisibleOnline: isVisibleOnline,
                isActive: true
            ))
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
