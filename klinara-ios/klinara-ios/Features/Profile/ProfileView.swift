import SwiftUI

/// Hesap ve oturum sekmesi.
///
/// `HomePlaceholderView`'in yerini alır: aynı bilgileri gösterir ama artık
/// akışın sonu değil, kabuğun bir sekmesidir.
struct ProfileView: View {

    @Bindable var authFlow: AuthFlowModel
    let session: AppSession

    @State private var showsDeveloperMenu = false
    @State private var showsLogoutConfirmation = false

    private var user: UserProfile { session.user }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    greeting
                    sessionCard
                    securityCard
                    developerSection
                    logoutButton
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("Profil")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    BranchMenu(session: session)
                }
            }
            .confirmationDialog(
                "Oturumu kapatmak istiyor musunuz?",
                isPresented: $showsLogoutConfirmation,
                titleVisibility: .visible
            ) {
                Button("Çıkış yap", role: .destructive) {
                    Task { await authFlow.logout() }
                }
                Button("Vazgeç", role: .cancel) {}
            }
        }
        .tint(KlinaraColor.sage)
    }

    // MARK: Parçalar

    private var greeting: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            Text("Hoş geldiniz")
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.sageDeep)

            Text(user.fullName)
                .klinaraText(.displayM)
                .foregroundStyle(KlinaraColor.charcoal)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var sessionCard: some View {
        KlinaraCard(title: "Oturum") {
            KlinaraRow(label: "Şube", value: session.selectedBranch?.name ?? "—")
            KlinaraDivider()
            KlinaraRow(label: "Rol", value: session.roleNames)
            KlinaraDivider()
            KlinaraRow(label: "E-posta", value: user.email)
            KlinaraDivider()
            KlinaraRow(
                label: "Telefon",
                value: user.phone.map(PhoneNumberField.pretty) ?? "—",
                detail: user.phone != nil && !user.phoneVerified ? "Doğrulanmadı" : nil
            )
        }
    }

    private var securityCard: some View {
        KlinaraCard(
            title: "Güvenlik",
            footnote: PasskeyRegistry.hasEnrolledPasskey
                ? nil
                : "Passkey kaydederseniz bir sonraki girişte parola yazmanız gerekmez."
        ) {
            KlinaraRow(
                label: "Passkey",
                value: PasskeyRegistry.hasEnrolledPasskey ? "Bu cihazda kayıtlı" : "Kayıtlı değil"
            ) {
                Image(systemName: PasskeyRegistry.hasEnrolledPasskey ? "checkmark.seal" : "seal")
                    .font(.system(size: 15))
                    .foregroundStyle(
                        PasskeyRegistry.hasEnrolledPasskey
                            ? KlinaraColor.sageDeep
                            : KlinaraColor.charcoalMuted
                    )
            }
        }
    }

    private var logoutButton: some View {
        KlinaraButton(title: "Çıkış yap", kind: .secondary) {
            showsLogoutConfirmation = true
        }
        .padding(.top, KlinaraMetrics.sm)
    }

    // MARK: Geliştirici menüsü

    @ViewBuilder
    private var developerSection: some View {
        if let mock = session.services.mockAuth {
            KlinaraCard {
                DisclosureGroup(isExpanded: $showsDeveloperMenu) {
                    DeveloperScenarioList(
                        mock: mock,
                        data: session.services.mockDataScenario,
                        onSelectData: { scenario in
                            session.services.applyMockData(scenario)
                            // Store'lar veriyi önbellekte tutuyor; oturumu
                            // düşürmeden yeni tohum ekrana yansımazdı.
                            Task { await authFlow.logout() }
                        }
                    ) { scenario in
                        mock.scenario = scenario
                        PasskeyRegistry.hasEnrolledPasskey = (scenario == .happyPasskey)
                        Task { await authFlow.logout() }
                    }
                    .padding(.top, KlinaraMetrics.md)
                } label: {
                    Text("Geliştirici")
                        .klinaraText(.label)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
                .tint(KlinaraColor.charcoalMuted)
                .padding(KlinaraMetrics.md)
            }
        }
    }
}
