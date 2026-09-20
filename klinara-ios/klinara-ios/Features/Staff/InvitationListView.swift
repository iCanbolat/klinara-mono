import SwiftUI

/// Bekleyen davetler — `user:invite`.
///
/// Kabul edilmiş ve iptal edilmiş davetler listelenmez; kabul edilen kişi
/// zaten Personel listesinde. Süresi dolmuş davet rozetle kalır: sessizce
/// kaybolması "davet gitmedi mi?" sorusunu doğururdu.
struct InvitationListView: View {

    let session: AppSession

    @State private var state: LoadState<[Invitation]> = .loading
    @State private var showsInvite = false
    @State private var pendingRevoke: Invitation?
    @State private var actionError: APIError?

    var body: some View {
        KlinaraScreen(
            state: state,
            skeleton: .cardsShort,
            emptyCheck: \.isEmpty,
            emptyTitle: "Bekleyen davet yok",
            emptyMessage: "Davet edilen kişi e-postadaki bağlantıyla parolasını belirleyip katılır.",
            emptyIcon: "envelope.badge",
            emptyActionTitle: "Personel davet et",
            emptyActionIcon: "person.badge.plus",
            emptyAction: { showsInvite = true },
            onRetry: { await load() }
        ) { invitations in
            if let actionError { ErrorBanner(error: actionError) }

            KlinaraCard(footnote: "İptal edilen davetin bağlantısı hemen geçersiz olur.") {
                ForEach(Array(invitations.enumerated()), id: \.element.id) { index, invitation in
                    if index > 0 { KlinaraDivider() }
                    row(for: invitation)
                }
            }
        }
        .navigationTitle("Davetler")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showsInvite = true
                } label: {
                    Image(systemName: "person.badge.plus")
                }
                .accessibilityLabel("Personel davet et")
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showsInvite) {
            InviteStaffView(session: session) { _ in
                Task { await load() }
            }
        }
        .confirmationDialog(
            "Davet iptal edilsin mi?",
            isPresented: .init(
                get: { pendingRevoke != nil },
                set: { if !$0 { pendingRevoke = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingRevoke
        ) { invitation in
            Button("Daveti iptal et", role: .destructive) {
                Task { await revoke(invitation) }
            }
        } message: { invitation in
            Text("\(invitation.email) adresine gönderilen bağlantı geçersiz olur.")
        }
    }

    private func row(for invitation: Invitation) -> some View {
        HStack(spacing: KlinaraMetrics.md) {
            VStack(alignment: .leading, spacing: 4) {
                Text(invitation.email)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .lineLimit(1)
                Text("\(RoleName.turkish(invitation.roleKey)) · \(branchName(invitation.branchId))")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                HStack(spacing: KlinaraMetrics.xs) {
                    if invitation.isExpired(now: .now) {
                        KlinaraBadge(text: "Süresi doldu", tone: .warning)
                    } else {
                        KlinaraBadge(
                            text: "Son gün \(invitation.expiresAt.formatted(.dateTime.day().month(.abbreviated)))",
                            tone: .muted
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                pendingRevoke = invitation
            } label: {
                Text("İptal et")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.danger)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
        }
        .padding(KlinaraMetrics.md)
    }

    private func branchName(_ id: String?) -> String {
        guard let id else { return "Kurum geneli" }
        return session.branches.first { $0.id == id }?.name ?? "Erişiminiz olmayan bir şube"
    }

    private func load() async {
        do {
            let all = try await session.services.users.invitations()
            state = .loaded(all.filter(\.isPending).sorted { $0.createdAt > $1.createdAt })
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    private func revoke(_ invitation: Invitation) async {
        actionError = nil
        do {
            try await session.services.users.revokeInvitation(id: invitation.id)
            if case .loaded(let list) = state {
                state = .loaded(list.filter { $0.id != invitation.id })
            }
        } catch {
            actionError = error as? APIError ?? .network
        }
    }
}

/// Personel davet formu: e-posta + rol (+ şube kapsamlı rolde şube).
struct InviteStaffView: View {

    let session: AppSession
    let onSent: (Invitation) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var fullName = ""
    @State private var roleKey = "practitioner"
    @State private var branchId: String?
    @State private var error: APIError?
    @State private var isSaving = false

    private var roles: [MembershipRules.Role] {
        MembershipRules.assignableRoles(for: session.profile.roles)
    }

    private var branches: [BranchSummary] {
        session.branches.filter {
            $0.isActive && (session.profile.tenantWide || session.profile.branchIds.contains($0.id))
        }
    }

    private var tenantScoped: Bool { MembershipRules.isTenantScoped(roleKey) }

    private var canSave: Bool {
        email.contains("@") && (tenantScoped || branchId != nil)
    }

    var body: some View {
        KlinaraFormScaffold(
            title: "Personel davet et",
            saveTitle: "Gönder",
            canSave: canSave,
            isDirty: !email.isEmpty || !fullName.isEmpty,
            isSaving: isSaving,
            error: error,
            onSave: send
        ) {
            KlinaraFormSection(
                title: "Kişi",
                footnote: "Davet edilen kişi e-postadaki bağlantıyla parolasını belirleyip katılır."
            ) {
                VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                    KlinaraTextField(
                        label: "E-posta",
                        text: $email,
                        placeholder: "ad@klinik.com",
                        error: error?.fieldErrors["email"],
                        textContentType: .emailAddress,
                        keyboardType: .emailAddress
                    )
                    KlinaraTextField(
                        label: "Ad soyad",
                        text: $fullName,
                        placeholder: "İsteğe bağlı",
                        error: error?.fieldErrors["fullName"],
                        textContentType: .name,
                        autocapitalization: .words
                    )
                }
                .padding(KlinaraMetrics.md)
            }

            KlinaraFormSection(title: "Rol ve şube") {
                VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                    Picker("Rol", selection: $roleKey) {
                        ForEach(roles) { role in
                            Text(role.name).tag(role.key)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(KlinaraColor.sageDeep)

                    if tenantScoped {
                        KlinaraRow(label: "Şube", value: "Kurum geneli")
                    } else {
                        Picker("Şube", selection: $branchId) {
                            Text("Şube seçin").tag(String?.none)
                            ForEach(branches) { branch in
                                Text(branch.name).tag(Optional(branch.id))
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(KlinaraColor.sageDeep)
                    }
                }
                .klinaraText(.bodyM)
                .padding(KlinaraMetrics.md)
            }
        }
        .onAppear {
            if !roles.contains(where: { $0.key == roleKey }) { roleKey = roles.last?.key ?? "" }
            if branchId == nil {
                branchId = branches.first { $0.id == session.selectedBranchId }?.id ?? branches.first?.id
            }
        }
    }

    private func send() async {
        error = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let trimmedName = fullName.trimmingCharacters(in: .whitespaces)
            let invitation = try await session.services.users.invite(CreateInvitationInput(
                email: email.trimmingCharacters(in: .whitespaces),
                roleKey: roleKey,
                branchId: tenantScoped ? nil : branchId,
                fullName: trimmedName.isEmpty ? nil : trimmedName
            ))
            onSent(invitation)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
