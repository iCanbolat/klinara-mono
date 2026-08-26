import SwiftUI

/// Kiracı politikası 2FA'yı zorunlu kılmış ama kullanıcı henüz kurmamış.
///
/// Bu ekran olmadan böyle bir kullanıcı mobilde **tamamen kilitli** kalırdı:
/// giriş `mfa_required` döner, doğrulayacak bir sırrı yoktur ve kurulum
/// yalnız web'de yapılabilirdi. Sunucu `POST /auth/2fa/setup` çağrısını
/// giriş akışındaki ara token ile kabul eder; kurulum tam burada tamamlanır.
struct TOTPSetupView: View {

    @Bindable var model: AuthFlowModel
    @State private var didCopySecret = false

    var body: some View {
        AuthScaffold(
            eyebrow: "Güvenlik",
            title: "İki adımlı doğrulamayı kurun",
            subtitle: "Kliniğiniz yönetici hesapları için iki adımlı doğrulamayı zorunlu kılmış.",
            onBack: { model.goBack() }
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let error = model.error {
                    ErrorBanner(error: error)
                }

                instructions
                secretCard

                VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
                    Text("Uygulamadaki kod")
                        .klinaraText(.label)
                        .foregroundStyle(KlinaraColor.charcoalMuted)

                    OTPCodeField(
                        code: $model.totpSetupCode,
                        hasError: model.error != nil
                    ) { _ in
                        submit()
                    }
                }
            }
        } actions: {
            KlinaraButton(
                title: "Kurulumu tamamla",
                isLoading: model.isBusy,
                isEnabled: model.totpSetupCode.count == 6
            ) {
                submit()
            }
        }
    }

    private func submit() {
        guard model.totpSetupCode.count == 6, !model.isBusy else { return }
        Task { await model.confirmTotpSetup() }
    }

    private var instructions: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            stepRow(1, "Bir doğrulama uygulaması açın (Google Authenticator, 1Password, Authy).")
            stepRow(2, "Aşağıdaki anahtarı elle ekleyin.")
            stepRow(3, "Uygulamanın ürettiği 6 haneli kodu girin.")
        }
    }

    private func stepRow(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: KlinaraMetrics.sm) {
            Text("\(number)")
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.sageDeep)
                .frame(width: 20, height: 20)
                .background(KlinaraColor.sageSoft)
                .clipShape(.circle)

            Text(text)
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var secretCard: some View {
        if let setup = model.totpSetup {
            VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
                Text("Kurulum anahtarı")
                    .klinaraText(.label)
                    .foregroundStyle(KlinaraColor.charcoalMuted)

                HStack(spacing: KlinaraMetrics.sm) {
                    Text(setup.secret)
                        .font(.system(.body, design: .monospaced))
                        .tracking(1.5)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .textSelection(.enabled)

                    Spacer(minLength: 0)

                    Button {
                        UIPasteboard.general.string = setup.secret
                        didCopySecret = true
                    } label: {
                        Image(systemName: didCopySecret ? "checkmark" : "doc.on.doc")
                            .foregroundStyle(didCopySecret ? KlinaraColor.sage : KlinaraColor.charcoalMuted)
                    }
                    .accessibilityLabel("Anahtarı kopyala")
                }
            }
            .padding(KlinaraMetrics.md)
            .background(KlinaraColor.surfaceRaised)
            .overlay(
                RoundedRectangle(cornerRadius: KlinaraMetrics.cardRadius)
                    .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
            )
            .clipShape(.rect(cornerRadius: KlinaraMetrics.cardRadius))
            .animation(KlinaraMetrics.feedback, value: didCopySecret)
        }
    }
}

#Preview {
    TOTPSetupView(model: AuthFlowModel(auth: MockAuthService(scenario: .mfaRequiredNotConfigured)))
}
