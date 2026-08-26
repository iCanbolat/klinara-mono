import SwiftUI

/// Parola kurtarma — **e-posta** ile.
///
/// Kullanıcı telefonuyla girmiş olsa bile kurtarma yolu e-postadır:
/// sıfırlama bağlantısı SMS ile gönderilmez (SIM swap yüzeyi).
struct ForgotPasswordEmailView: View {

    @Bindable var model: AuthFlowModel

    private var canSubmit: Bool {
        model.forgotPasswordEmail.contains("@") && model.forgotPasswordEmail.count > 4
    }

    var body: some View {
        AuthScaffold(
            eyebrow: "Kurtarma",
            title: "Parolanızı sıfırlayın",
            subtitle: "Hesabınıza kayıtlı e-posta adresini girin. Sıfırlama bağlantısını oraya gönderelim.",
            onBack: { model.goBack() }
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                if let error = model.error {
                    ErrorBanner(error: error)
                }

                KlinaraTextField(
                    label: "E-posta",
                    text: $model.forgotPasswordEmail,
                    placeholder: "ornek@klinik.com",
                    textContentType: .emailAddress,
                    keyboardType: .emailAddress,
                    submitLabel: .send
                ) {
                    submit()
                }

                Label(
                    "Telefon numaranızı değiştirmeniz gerekiyorsa da bu yolu kullanın.",
                    systemImage: "info.circle"
                )
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoalMuted)
            }
        } actions: {
            KlinaraButton(
                title: "Sıfırlama bağlantısı gönder",
                isLoading: model.isBusy,
                isEnabled: canSubmit
            ) {
                submit()
            }
        }
    }

    private func submit() {
        guard canSubmit, !model.isBusy else { return }
        Task { await model.submitForgotPassword() }
    }
}

#Preview {
    ForgotPasswordEmailView(model: AuthFlowModel(auth: MockAuthService()))
}
