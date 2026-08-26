import SwiftUI

/// Personel listesi.
struct StaffListView: View {

    let session: AppSession

    @State private var searchText = ""
    @State private var showsInactive = false
    @State private var showsCreate = false

    private var store: StaffStore { session.staffStore }
    private var canWrite: Bool { session.can(Permissions.staffWrite) }

    var body: some View {
        KlinaraScreen(
            state: store.state,
            emptyCheck: \.isEmpty,
            emptyTitle: "Personel yok",
            emptyMessage: canWrite
                ? "Personel profili mevcut bir kullanıcıya bağlanır. Önce kullanıcıyı davet edin, sonra buradan profilini oluşturun."
                : "Personel eklemek için yöneticinizle görüşün.",
            emptyIcon: "person.text.rectangle",
            onRetry: { await store.reload() }
        ) { profiles in
            let visible = filtered(profiles)

            if visible.isEmpty {
                Text("Aramanızla eşleşen personel yok.")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, KlinaraMetrics.xl)
            }

            KlinaraCard {
                ForEach(Array(visible.enumerated()), id: \.element.id) { index, profile in
                    if index > 0 { KlinaraDivider() }
                    row(for: profile)
                }
            }
        }
        .navigationTitle("Personel")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Personel ara")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Toggle("Pasifleri göster", isOn: $showsInactive)
                    if canWrite {
                        Button {
                            showsCreate = true
                        } label: {
                            Label("Yeni personel", systemImage: "plus")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Seçenekler")
            }
        }
        .task {
            await store.load()
            // Yetkinlik matrisi hizmet listesine bakıyor; detaya girildiğinde
            // beklememek için katalogla birlikte yükleniyor.
            await session.catalogStore.load()
        }
        .refreshable { await store.reload() }
        .sheet(isPresented: $showsCreate) {
            StaffCreateView(session: session)
        }
    }

    private func row(for profile: StaffProfile) -> some View {
        NavigationLink {
            StaffDetailView(session: session, staffProfileId: profile.id)
        } label: {
            HStack(spacing: KlinaraMetrics.md) {
                ColorDot(hex: profile.calendarColor, size: 12)

                VStack(alignment: .leading, spacing: 4) {
                    Text(profile.userFullName)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    if let title = profile.title, !title.isEmpty {
                        Text(title)
                            .klinaraText(.bodyM)
                            .font(.footnote)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    HStack(spacing: KlinaraMetrics.xs) {
                        KlinaraBadge(
                            text: "\(activeSkillCount(profile)) hizmet",
                            tone: activeSkillCount(profile) == 0 ? .warning : .neutral
                        )
                        if !profile.isActive {
                            KlinaraBadge(text: "Pasif", tone: .muted)
                        }
                        if profile.isVisibleOnline {
                            KlinaraBadge(text: "Online", tone: .positive, icon: "globe")
                        }
                    }
                    .padding(.top, 2)
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
            .padding(KlinaraMetrics.md)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    /// Yetkinliksiz personel randevu alamaz; sayıyı listede göstermek bu
    /// sessiz durumu görünür kılar.
    private func activeSkillCount(_ profile: StaffProfile) -> Int {
        Set(profile.services.filter(\.isActive).map(\.serviceId)).count
    }

    private func filtered(_ profiles: [StaffProfile]) -> [StaffProfile] {
        profiles
            .filter { showsInactive || $0.isActive }
            .filter { profile in
                guard !searchText.isEmpty else { return true }
                return profile.userFullName.localizedCaseInsensitiveContains(searchText)
                    || (profile.title ?? "").localizedCaseInsensitiveContains(searchText)
                    || profile.specialties.contains { $0.localizedCaseInsensitiveContains(searchText) }
            }
            .sorted { $0.userFullName.localizedStandardCompare($1.userFullName) == .orderedAscending }
    }
}
