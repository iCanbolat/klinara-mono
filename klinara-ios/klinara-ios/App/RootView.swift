import SwiftUI

/// Akış yönlendiricisi.
///
/// `AuthFlowModel.step` neredeyse bire bir ekranlara eşlenir. Gezinme
/// yığını (`NavigationStack`) **bilinçli olarak kullanılmaz**: giriş akışı
/// bir ağaç değil doğrusal bir durum makinesidir ve yığın, "2FA ekranından
/// geri gidip yarım kimlikle takılma" gibi durumları davet eder.
///
/// Akış bittiğinde yerini ``AppShellView``'e bırakır — o noktadan sonra
/// gezinme normal SwiftUI yığınlarıyla yapılır.
struct RootView: View {

    @State private var model: AuthFlowModel
    private let services: ServiceContainer

    init(services: ServiceContainer, passkeys: (any PasskeyPerforming)? = nil) {
        _model = State(wrappedValue: AuthFlowModel(services: services, passkeys: passkeys))
        self.services = services
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
        .task {
            // Sunucu oturumu düşürdüğünde (yenileme de başarısız) kullanıcıyı
            // giriş ekranına döndür. `APIClient` gezinme bilmez, yalnız haber verir.
            await services.onSessionExpired { [weak model] in
                Task { @MainActor in await model?.logout() }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.step {
        case .launch:
            LaunchView()

        case .identifier:
            IdentifierView(model: model, mock: services.mockAuth)

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
            if let session = model.session {
                AppShellView(authFlow: model, session: session)
            } else {
                // `finishAuthentication` profil olmadan buraya geçmez;
                // yine de tip düzeyinde bir boşluk bırakmıyoruz.
                LaunchView()
            }
        }
    }
}

#Preview("Akış") {
    RootView(services: .mock())
}
