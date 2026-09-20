import SwiftUI

/// Personel listesi.
///
/// Şube süzgeci varsayılan olarak seçili şubede: ana şubesi o şube **veya**
/// orada rolü olan personel (sunucudaki `GET staff?branchId=` kuralı,
/// ``StaffProfile/worksIn(branchId:)``). "Tüm şubeler" yalnız kiracı geneli
/// rollerde. Roller `user:read` varsa satırda gösteriliyor.
struct StaffListView: View {

    let session: AppSession

    @State private var searchText = ""
    @State private var showsInactive = false
    @State private var showsCreate = false
    @State private var showsInvite = false
    /// `nil` = oturumun seçili şubesi, `""` = tüm şubeler.
    @State private var branchFilter: String?
    @State private var membershipsByUser: [String: [MembershipSummary]] = [:]

    private var store: StaffStore { session.staffStore }
    private var canWrite: Bool { session.can(Permissions.staffWrite) }
    private var canInvite: Bool { session.can(Permissions.userInvite) }

    /// Etkin süzgeç: `nil` = tüm şubeler.
    private var effectiveBranchId: String? {
        let value = branchFilter ?? session.selectedBranchId
        return value == "" ? nil : value
    }

    var body: some View {
        KlinaraScreen(
            state: store.state,
            skeleton: .cardsLong,
            emptyCheck: \.isEmpty,
            emptyTitle: "Personel yok",
            emptyMessage: canWrite
                ? "Personel profili mevcut bir kullanıcıya bağlanır. Önce kullanıcıyı davet edin, sonra buradan profilini oluşturun."
                : "Personel eklemek için yöneticinizle görüşün.",
            emptyIcon: "person.text.rectangle",
            // Personel profili mevcut bir kullanıcıya bağlanır: boş listede
            // yapılacak ilk iş davet etmek, profil açmak değil.
            emptyActionTitle: canInvite ? "Personel davet et" : (canWrite ? "Yeni personel" : nil),
            emptyActionIcon: canInvite ? "person.badge.plus" : "plus",
            emptyAction: canInvite
                ? { showsInvite = true }
                : (canWrite ? { showsCreate = true } : nil),
            onRetry: { await store.reload() }
        ) { profiles in
            let visible = filtered(profiles)

            if visible.isEmpty {
                Text(searchText.isEmpty ? "Bu şubede personel yok. Rol ve şube atamasını personelin detayından yapabilirsiniz." : "Aramanızla eşleşen personel yok.")
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
        .klinaraFAB(isVisible: canInvite || canWrite) { addButton }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                branchFilterBar
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Toggle("Pasifleri göster", isOn: $showsInactive)
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
            await loadMemberships()
        }
        .refreshable {
            await store.reload()
            await loadMemberships()
        }
        .sheet(isPresented: $showsCreate) {
            StaffCreateView(session: session)
        }
        .sheet(isPresented: $showsInvite) {
            InviteStaffView(session: session) { _ in }
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

                    if let roles = roleSummary(for: profile) {
                        Text(roles)
                            .klinaraText(.bodyM)
                            .font(.footnote)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .lineLimit(2)
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

    /// FAB: iki aksiyon da mümkünse menü, yalnız biri mümkünse doğrudan o.
    @ViewBuilder
    private var addButton: some View {
        if canInvite && canWrite {
            Menu {
                Button {
                    showsInvite = true
                } label: {
                    Label("Personel davet et", systemImage: "person.badge.plus")
                }
                Button {
                    showsCreate = true
                } label: {
                    Label("Yeni personel", systemImage: "person.crop.circle.badge.plus")
                }
            } label: {
                KlinaraFABLabel()
            }
            .accessibilityLabel("Personel ekle")
        } else if canInvite {
            KlinaraFloatingActionButton(accessibilityLabel: "Personel davet et") { showsInvite = true }
        } else {
            KlinaraFloatingActionButton(accessibilityLabel: "Yeni personel") { showsCreate = true }
        }
    }

    /// Şube süzgeci, gezinme çubuğunda — hangi şubeye bakıldığı her an görünür olsun.
    /// Oturumun şubesini değiştirmez, yalnız bu listeyi daraltır.
    private var branchFilterBar: some View {
        Menu {
            Picker("Şube", selection: Binding(
                get: { effectiveBranchId ?? "" },
                set: { branchFilter = $0 }
            )) {
                if session.profile.tenantWide {
                    Text("Tüm şubeler").tag("")
                }
                ForEach(session.switchableBranches) { branch in
                    Text(branch.name).tag(branch.id)
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(effectiveBranchId.flatMap { id in session.branches.first { $0.id == id }?.name } ?? "Tüm şubeler")
                    .klinaraText(.bodyM)
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(KlinaraColor.sageDeep)
            .padding(.horizontal, KlinaraMetrics.sm)
        }
        .accessibilityLabel("Şube süzgeci")
    }

    private func roleSummary(for profile: StaffProfile) -> String? {
        guard let memberships = membershipsByUser[profile.userId], !memberships.isEmpty else { return nil }
        return memberships.map { membership in
            let branch = membership.branchId.map { id in
                session.branches.first { $0.id == id }?.name ?? "başka şube"
            } ?? "kurum geneli"
            return "\(RoleName.turkish(membership.roleKey)) · \(branch)"
        }
        .joined(separator: ", ")
    }

    private func loadMemberships() async {
        guard session.can(Permissions.userRead),
              let users = try? await session.services.users.users()
        else { return }
        membershipsByUser = Dictionary(uniqueKeysWithValues: users.map { ($0.id, $0.memberships) })
    }

    private func filtered(_ profiles: [StaffProfile]) -> [StaffProfile] {
        profiles
            .filter { profile in effectiveBranchId.map { profile.worksIn(branchId: $0) } ?? true }
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
