import SwiftUI

/// Personel profili — düzenleme + yetkinlik ve takvim kısayolları.
struct StaffDetailView: View {

    let session: AppSession
    let staffProfileId: String

    @State private var draft: StaffProfileDraft?
    @State private var error: APIError?
    @State private var saved = false

    private var store: StaffStore { session.staffStore }
    private var canWrite: Bool { session.can(Permissions.staffWrite) }
    private var profile: StaffProfile? { store.profile(id: staffProfileId) }

    var body: some View {
        ZStack {
            KlinaraColor.surface.ignoresSafeArea()

            if let profile, let draft {
                content(profile: profile, draft: draft)
            } else {
                ProgressView()
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(profile?.userFullName ?? "Personel")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canWrite, let draft, draft.isDirty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Kaydet") { Task { await save() } }
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.sageDeep)
                        .disabled(store.isSaving)
                }
            }
        }
        .task {
            await store.load()
            await session.catalogStore.load()
            if draft == nil, let profile { draft = StaffProfileDraft(profile: profile) }
        }
    }

    @ViewBuilder
    private func content(profile: StaffProfile, draft: StaffProfileDraft) -> some View {
        let binding = Binding(get: { draft }, set: { self.draft = $0 })

        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let error, !error.isFieldScoped {
                    ErrorBanner(error: error)
                }
                if saved {
                    Text("Değişiklikler kaydedildi.")
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.sageDeep)
                }

                identityCard(profile: profile)
                profileCard(binding: binding)
                linksCard(profile: profile)
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .scrollDismissesKeyboard(.interactively)
        .overlay {
            if store.isSaving { AuthLoadingOverlay(message: "Kaydediliyor…") }
        }
    }

    private func identityCard(profile: StaffProfile) -> some View {
        KlinaraCard(title: "Hesap") {
            KlinaraRow(label: "Ad soyad", value: profile.userFullName)
            KlinaraDivider()
            KlinaraRow(label: "E-posta", value: profile.userEmail)
        }
    }

    private func profileCard(binding: Binding<StaffProfileDraft>) -> some View {
        KlinaraCard(title: "Profil") {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraTextField(
                    label: "Unvan",
                    text: binding.title,
                    placeholder: "Dermatolog",
                    error: error?.fieldErrors["title"],
                    autocapitalization: .words
                )

                KlinaraTagField(label: "Uzmanlıklar", tags: binding.specialties)

                KlinaraTextField(
                    label: "Kısa tanıtım",
                    text: binding.bio,
                    placeholder: "Online randevu sayfasında görünür",
                    error: error?.fieldErrors["bio"],
                    autocapitalization: .sentences
                )

                ColorSwatchPicker(label: "Takvim rengi", hex: binding.calendarColor)

                Picker("Birincil şube", selection: binding.primaryBranchId) {
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
            .disabled(!canWrite)

            KlinaraDivider()
            KlinaraToggleRow(
                label: "Online sayfada görünsün",
                detail: "Müşteriler bu personeli seçebilir",
                isOn: binding.isVisibleOnline,
                isEnabled: canWrite
            )
            KlinaraDivider()
            KlinaraToggleRow(
                label: "Aktif",
                detail: "Pasif personele randevu açılamaz",
                isOn: binding.isActive,
                isEnabled: canWrite
            )
        }
    }

    private func linksCard(profile: StaffProfile) -> some View {
        KlinaraCard(title: "Çalışma") {
            KlinaraNavigationRow(
                label: "Hizmet yetkinlikleri",
                value: "\(Set(profile.services.filter(\.isActive).map(\.serviceId)).count)",
                detail: "Bu personelin yapabildiği hizmetler",
                icon: "checklist"
            ) {
                StaffServiceMatrixView(session: session, staffProfileId: profile.id)
            }

            if session.can(Permissions.scheduleRead) {
                KlinaraDivider()
                KlinaraNavigationRow(
                    label: "Haftalık çalışma programı",
                    detail: session.selectedBranch?.name ?? "Şube seçin",
                    icon: "calendar.badge.clock"
                ) {
                    StaffScheduleView(session: session, staffProfileId: profile.id)
                }
                KlinaraDivider()
                KlinaraNavigationRow(
                    label: "İzin ve istisnalar",
                    detail: "Bu personele ait kayıtlar",
                    icon: "calendar.badge.exclamationmark"
                ) {
                    ScheduleExceptionListView(session: session, staffProfileId: profile.id)
                }
            }
        }
    }

    private func save() async {
        guard let draft else { return }
        error = nil
        saved = false
        do {
            let updated = try await store.update(id: staffProfileId, draft.updateInput())
            self.draft = StaffProfileDraft(profile: updated)
            saved = true
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}

/// Profil düzenleme taslağı.
///
/// Sunucudan gelen `StaffProfile` doğrudan düzenlenemez (`let` alanlar) ve
/// düzenlenebilir olsaydı da kirli-durum takibi imkânsız olurdu — neyin
/// değiştiğini bilmeden "Kaydet" düğmesi her zaman aktif kalırdı.
struct StaffProfileDraft: Equatable {

    var title: String
    var bio: String
    var specialties: [String]
    var calendarColor: String?
    var primaryBranchId: String?
    var isVisibleOnline: Bool
    var isActive: Bool

    private let original: Fields

    private struct Fields: Equatable {
        var title: String
        var bio: String
        var specialties: [String]
        var calendarColor: String?
        var primaryBranchId: String?
        var isVisibleOnline: Bool
        var isActive: Bool
    }

    init(profile: StaffProfile) {
        title = profile.title ?? ""
        bio = profile.bio ?? ""
        specialties = profile.specialties
        calendarColor = profile.calendarColor
        primaryBranchId = profile.primaryBranchId
        isVisibleOnline = profile.isVisibleOnline
        isActive = profile.isActive
        original = Fields(
            title: title, bio: bio, specialties: specialties,
            calendarColor: calendarColor, primaryBranchId: primaryBranchId,
            isVisibleOnline: isVisibleOnline, isActive: isActive
        )
    }

    var isDirty: Bool { current != original }

    private var current: Fields {
        Fields(
            title: title, bio: bio, specialties: specialties,
            calendarColor: calendarColor, primaryBranchId: primaryBranchId,
            isVisibleOnline: isVisibleOnline, isActive: isActive
        )
    }

    func updateInput() -> UpdateStaffProfileInput {
        UpdateStaffProfileInput(
            primaryBranchId: primaryBranchId,
            title: title.isEmpty ? nil : title,
            specialties: specialties,
            calendarColor: calendarColor,
            bio: bio.isEmpty ? nil : bio,
            isVisibleOnline: isVisibleOnline,
            isActive: isActive
        )
    }
}
