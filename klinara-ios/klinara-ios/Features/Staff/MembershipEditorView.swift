import SwiftUI

/// Personelin rolleri ve çalıştığı şubeler — `PUT users/:id/memberships`.
///
/// Liste **tamamen** değiştirilir. Bu yüzden:
/// - Sizden yetkili bir rol kilitli gösterilir ve olduğu gibi geri gönderilir
///   (gizlemek, onu sessizce silmeye çalışmak olurdu).
/// - Erişemediğiniz bir şubede de rolü olan kişinin rolleri düzenlenemez:
///   o satırı "dokunmadan" geri göndermek bile sunucuda 403.
/// - Tüm rolleri kaldırmak kişiyi klinikten çıkarır; ayrıca onay istenir.
/// - Kaydedilmemiş değişiklikle geri dönmek onay ister.
struct MembershipEditorView: View {

    let session: AppSession
    let userId: String
    let userName: String

    @Environment(\.dismiss) private var dismiss

    @State private var saved: [MembershipRules.Draft]?
    @State private var rows: [MembershipRules.Draft] = []
    @State private var loadError: APIError?
    @State private var error: APIError?
    @State private var isSaving = false
    @State private var showsAdd = false
    @State private var confirmsEmpty = false
    @State private var confirmsLeave = false
    @State private var didSave = false

    private var viewer: MembershipRules.Viewer {
        MembershipRules.Viewer(
            userId: session.user.id,
            roles: session.profile.roles,
            branchIds: session.profile.branchIds,
            tenantWide: session.profile.tenantWide
        )
    }

    private var canWrite: Bool { session.canAny(Permissions.userWrite, Permissions.userInvite) }

    private var editorLock: MembershipRules.EditorLock? {
        guard let saved else { return nil }
        return MembershipRules.editorLock(userId: userId, rows: saved, viewer: viewer)
    }

    private var isEditable: Bool { canWrite && editorLock == nil }
    private var isDirty: Bool { saved.map { !MembershipRules.same(rows, $0) } ?? false }
    private var issues: [String: MembershipRules.Issue] { MembershipRules.issues(rows) }

    var body: some View {
        ZStack {
            KlinaraColor.surface.ignoresSafeArea()
            if saved != nil {
                content
            } else if let loadError {
                ErrorBanner(error: loadError, onRetry: { Task { await load() } })
                    .padding(KlinaraMetrics.screenInset)
            } else {
                ProgressView().tint(KlinaraColor.sage)
            }
        }
        .navigationTitle("Roller ve şubeler")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(isDirty)
        .toolbar {
            if isDirty {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { confirmsLeave = true }
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            if isEditable {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Kaydet") {
                        if rows.isEmpty { confirmsEmpty = true } else { Task { await save() } }
                    }
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(isDirty && issues.isEmpty ? KlinaraColor.sageDeep : KlinaraColor.charcoalMuted)
                    .disabled(!isDirty || !issues.isEmpty || isSaving)
                }
            }
        }
        .task { if saved == nil { await load() } }
        .sheet(isPresented: $showsAdd) {
            MembershipAddSheet(session: session, viewer: viewer) { draft in
                rows.append(draft)
            }
            .presentationDetents([.medium, .large])
        }
        .confirmationDialog(
            "Tüm roller kaldırılsın mı?",
            isPresented: $confirmsEmpty,
            titleVisibility: .visible
        ) {
            Button("Rolleri kaldır", role: .destructive) { Task { await save() } }
            Button("Vazgeç", role: .cancel) {}
        } message: {
            Text("\(userName) kliniğe erişimini tamamen kaybeder.")
        }
        .confirmationDialog(
            "Değişiklikler kaydedilmedi",
            isPresented: $confirmsLeave,
            titleVisibility: .visible
        ) {
            Button("Değişiklikleri sil", role: .destructive) { dismiss() }
            Button("Düzenlemeye dön", role: .cancel) {}
        }
        .overlay {
            if isSaving { AuthLoadingOverlay(message: "Kaydediliyor…") }
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let error { ErrorBanner(error: error) }

                if let notice {
                    Text(notice)
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                } else if didSave {
                    Text("Roller kaydedildi. Değişiklik hemen geçerli.")
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.sageDeep)
                }

                KlinaraCard(
                    title: userName,
                    footnote: "Liste kaydedildiğinde tamamen değiştirilir."
                ) {
                    if rows.isEmpty {
                        KlinaraRow(label: "Klinikte rolü yok")
                    }
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { KlinaraDivider() }
                        rowView(row)
                    }
                    if isEditable {
                        KlinaraDivider()
                        Button {
                            showsAdd = true
                        } label: {
                            Label("Rol ekle", systemImage: "plus.circle")
                                .klinaraText(.bodyEmphasis)
                                .foregroundStyle(KlinaraColor.sageDeep)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(KlinaraMetrics.md)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
    }

    private var notice: String? {
        switch editorLock {
        case .selfEdit: "Kendi rollerinizi değiştiremezsiniz; bunu sizden yetkili biri yapmalı."
        case .branch: "Bu kişinin erişiminiz olmayan bir şubede de rolü var. Rolleri, tüm şubelerine erişimi olan biri düzenleyebilir."
        case nil: canWrite ? nil : "Rolleri görüntüleyebilirsiniz ama değiştiremezsiniz."
        }
    }

    private func rowView(_ row: MembershipRules.Draft) -> some View {
        let lock = MembershipRules.lock(for: row, viewer: viewer)
        let issue = issues[row.id]
        return HStack(alignment: .center, spacing: KlinaraMetrics.md) {
            VStack(alignment: .leading, spacing: 4) {
                Text(RoleName.turkish(row.roleKey))
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                Text(branchName(row.branchId))
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                if issue == .duplicate {
                    Text("Bu rol bu şubede zaten var.")
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.danger)
                }
                if lock == .rank {
                    Text("Sizden yetkili bir rol — değiştirilemez.")
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if isEditable, lock == nil {
                Button(role: .destructive) {
                    rows.removeAll { $0.id == row.id }
                } label: {
                    Image(systemName: "minus.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(KlinaraColor.danger)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Rolü kaldır: \(RoleName.turkish(row.roleKey))")
            } else if lock != nil {
                Image(systemName: "lock.fill")
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(width: 44, height: 44)
                    .accessibilityLabel(lock == .rank ? "Sizden yetkili rol" : "Erişiminiz olmayan şube")
            }
        }
        .padding(.horizontal, KlinaraMetrics.md)
        .padding(.vertical, KlinaraMetrics.sm)
        .accessibilityElement(children: .combine)
    }

    private func branchName(_ id: String?) -> String {
        guard let id else { return "Kurum geneli" }
        return session.branches.first { $0.id == id }?.name ?? "Erişiminiz olmayan bir şube"
    }

    private func load() async {
        loadError = nil
        do {
            let memberships = try await session.services.users.memberships(userId: userId)
            let drafts = MembershipRules.drafts(memberships)
            saved = drafts
            rows = drafts
        } catch {
            loadError = error as? APIError ?? .network
        }
    }

    private func save() async {
        error = nil
        didSave = false
        isSaving = true
        defer { isSaving = false }
        do {
            let result = try await session.services.users.replaceMemberships(
                userId: userId,
                MembershipRules.inputs(rows)
            )
            let drafts = MembershipRules.drafts(result)
            saved = drafts
            rows = drafts
            didSave = true
            // Personel listesinin şube süzgeci üyeliklere bakıyor.
            await session.staffStore.reload()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}

/// Rol + şube seçip satır ekleme sayfası.
private struct MembershipAddSheet: View {

    let session: AppSession
    let viewer: MembershipRules.Viewer
    let onAdd: (MembershipRules.Draft) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var roleKey = "practitioner"
    @State private var branchId: String?

    private var roles: [MembershipRules.Role] { MembershipRules.assignableRoles(for: viewer.roles) }

    /// Yalnız erişebildiğim aktif şubeler atanabilir.
    private var branches: [BranchSummary] {
        session.branches.filter { $0.isActive && (viewer.tenantWide || viewer.branchIds.contains($0.id)) }
    }

    private var tenantScoped: Bool { MembershipRules.isTenantScoped(roleKey) }

    var body: some View {
        NavigationStack {
            Form {
                Section("Rol") {
                    Picker("Rol", selection: $roleKey) {
                        ForEach(roles) { role in
                            Text(role.name).tag(role.key)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section {
                    if tenantScoped {
                        Text("Kurum geneli — tüm şubelerde geçerli")
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                    } else {
                        Picker("Şube", selection: $branchId) {
                            Text("Şube seçin").tag(String?.none)
                            ForEach(branches) { branch in
                                Text(branch.name).tag(Optional(branch.id))
                            }
                        }
                    }
                } header: {
                    Text("Şube")
                }
            }
            .scrollContentBackground(.hidden)
            .background(KlinaraColor.surface)
            .navigationTitle("Rol ekle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Ekle") {
                        onAdd(MembershipRules.Draft(
                            id: "new-\(UUID().uuidString)",
                            roleKey: roleKey,
                            branchId: tenantScoped ? nil : branchId
                        ))
                        dismiss()
                    }
                    .disabled(!tenantScoped && branchId == nil)
                }
            }
            .onAppear {
                if !roles.contains(where: { $0.key == roleKey }) { roleKey = roles.last?.key ?? "" }
                if branchId == nil {
                    branchId = branches.first { $0.id == session.selectedBranchId }?.id ?? branches.first?.id
                }
            }
        }
        .tint(KlinaraColor.sage)
    }
}
