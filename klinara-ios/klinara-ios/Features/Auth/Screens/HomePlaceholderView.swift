import SwiftUI

/// Akışın bittiğini gösteren geçici ekran.
///
/// Faz 2 (takvim, müşteri, randevu) ekranları buraya bağlanacak. Şimdilik
/// oturumun doğru kurulduğunu görmeye ve senaryolar arasında geçmeye yarar.
struct HomePlaceholderView: View {

    @Bindable var model: AuthFlowModel
    /// Geliştirici menüsü — yalnız mock servis kullanılırken vardır.
    let mock: MockAuthService?

    @State private var showsDeveloperMenu = false

    private var user: UserProfile? { model.profile?.user }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    greeting
                    sessionCard
                    developerSection
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("Klinara")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Çıkış yap") {
                        Task { await model.logout() }
                    }
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.sageDeep)
                }
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

            Text(user?.fullName ?? "—")
                .klinaraText(.displayM)
                .foregroundStyle(KlinaraColor.charcoal)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var sessionCard: some View {
        VStack(spacing: 0) {
            infoRow("Klinik", value: model.profile?.tenantId ?? "—", isMonospaced: true)
            divider
            infoRow("Şube", value: currentBranchName)
            divider
            infoRow("Rol", value: (model.profile?.roles ?? []).map(RoleName.turkish).joined(separator: ", "))
            divider
            infoRow("Telefon", value: user?.phone.map(PhoneNumberField.pretty) ?? "—")
            divider
            infoRow("Passkey", value: PasskeyRegistry.hasEnrolledPasskey ? "Bu cihazda kayıtlı" : "Kayıtlı değil")
        }
        .background(KlinaraColor.surfaceRaised)
        .overlay(
            RoundedRectangle(cornerRadius: KlinaraMetrics.cardRadius)
                .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
        )
        .clipShape(.rect(cornerRadius: KlinaraMetrics.cardRadius))
    }

    private var currentBranchName: String {
        guard let id = TokenStore.shared.branchId else { return "—" }
        return model.branches.first { $0.id == id }?.name ?? "—"
    }

    private func infoRow(_ label: String, value: String, isMonospaced: Bool = false) -> some View {
        HStack(alignment: .top, spacing: KlinaraMetrics.md) {
            Text(label)
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .frame(width: 80, alignment: .leading)

            Text(value)
                .klinaraText(.bodyM)
                .font(isMonospaced ? .system(.footnote, design: .monospaced) : nil)
                .foregroundStyle(KlinaraColor.charcoal)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(KlinaraMetrics.md)
    }

    private var divider: some View {
        Rectangle()
            .fill(KlinaraColor.border)
            .frame(height: 1)
    }

    // MARK: Geliştirici menüsü

    @ViewBuilder
    private var developerSection: some View {
        if let mock {
            DisclosureGroup(isExpanded: $showsDeveloperMenu) {
                DeveloperScenarioList(mock: mock) { scenario in
                    mock.scenario = scenario
                    PasskeyRegistry.hasEnrolledPasskey = (scenario == .happyPasskey)
                    Task { await model.logout() }
                }
                .padding(.top, KlinaraMetrics.md)
            } label: {
                Text("Geliştirici")
                    .klinaraText(.label)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
            .tint(KlinaraColor.charcoalMuted)
            .padding(KlinaraMetrics.md)
            .background(KlinaraColor.surfaceRaised)
            .overlay(
                RoundedRectangle(cornerRadius: KlinaraMetrics.cardRadius)
                    .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
            )
            .clipShape(.rect(cornerRadius: KlinaraMetrics.cardRadius))
        }
    }
}

#Preview {
    let mock = MockAuthService()
    let model = AuthFlowModel(auth: mock)
    return HomePlaceholderView(model: model, mock: mock)
}
