import SwiftUI

/// Akış yönlendiricisi.
///
/// `AuthFlowModel.step` neredeyse bire bir ekranlara eşlenir. Gezinme
/// yığını (`NavigationStack`) **bilinçli olarak kullanılmaz**: giriş akışı
/// bir ağaç değil doğrusal bir durum makinesidir ve yığın, "2FA ekranından
/// geri gidip yarım kimlikle takılma" gibi durumları davet eder.
struct RootView: View {

    @State private var model: AuthFlowModel
    private let mock: MockAuthService?

    init(auth: any AuthService, passkeys: (any PasskeyPerforming)? = nil) {
        _model = State(wrappedValue: AuthFlowModel(auth: auth, passkeys: passkeys))
        mock = auth as? MockAuthService
    }

    var body: some View {
        ZStack {
            KlinaraColor.surface.ignoresSafeArea()

            content
                .transition(.asymmetric(
                    insertion: .move(edge: .trailing).combined(with: .opacity),
                    removal: .opacity
                ))

            if let message = model.overlayMessage {
                AuthLoadingOverlay(message: message)
            }
        }
        .animation(KlinaraMetrics.stepTransition, value: model.step)
        .animation(KlinaraMetrics.feedback, value: model.overlayMessage)
        .task { await model.start() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.step {
        case .launch:
            LaunchView()

        case .identifier:
            IdentifierView(model: model, mock: mock)

        case .password:
            PasswordView(model: model)

        case .totp:
            TOTPView(model: model)

        case .totpSetup:
            TOTPSetupView(model: model)

        case .backupCodesDisplay:
            BackupCodesView(model: model)

        case .backupCode:
            BackupCodeEntryView(model: model)

        case .forgotPasswordEmail:
            ForgotPasswordEmailView(model: model)

        case .forgotPasswordSent:
            ForgotPasswordSentView(model: model)

        case .tenantSelect:
            TenantSelectView(model: model)

        case .branchSelect:
            BranchSelectView(model: model)

        case .phoneVerification:
            PhoneVerificationView(model: model)

        case .passkeyEnrollOffer:
            PasskeyEnrollOfferView(model: model)

        case .authenticated:
            HomePlaceholderView(model: model, mock: mock)
        }
    }
}

#Preview("Akış") {
    RootView(auth: MockAuthService())
}
