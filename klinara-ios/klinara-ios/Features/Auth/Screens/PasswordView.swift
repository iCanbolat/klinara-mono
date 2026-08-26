import SwiftUI

/// Girişin ikinci adımı: parola.
///
/// Passkey'i olmayan ya da çalışmayan kullanıcı için kalıcı yedek yol.
/// Tanımlayıcı üstte özet olarak durur — kullanıcı hangi hesaba giriş
/// yaptığını görür ve tek dokunuşla değiştirebilir.
struct PasswordView: View {

    @Bindable var model: AuthFlowModel

    var body: some View {
        AuthScaffold(
            eyebrow: "Giriş",
            title: "Parolanızı girin",
            onBack: { model.goBack() }
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                identifierSummary

                if let error = model.error {
                    ErrorBanner(error: error)
                }

                KlinaraTextField(
                    label: "Parola",
                    text: $model.password,
                    isSecure: true,
                    textContentType: .password,
                    submitLabel: .go
                ) {
                    submit()
                }
            }
        } actions: {
            KlinaraButton(
                title: "Giriş yap",
                isLoading: model.isBusy,
                isEnabled: model.canSubmitPassword
            ) {
                submit()
            }

            KlinaraButton(title: "Parolamı unuttum", kind: .tertiary) {
                model.openForgotPassword()
            }
        }
    }

    private func submit() {
        guard model.canSubmitPassword else { return }
        Task { await model.submitPassword() }
    }

    private var identifierSummary: some View {
        HStack(spacing: KlinaraMetrics.sm) {
            Image(systemName: model.identifierMode == .phone ? "phone" : "envelope")
                .font(.system(size: 15))
                .foregroundStyle(KlinaraColor.charcoalMuted)

            Text(model.identifierSummary)
                .klinaraText(.bodyEmphasis)
                .foregroundStyle(KlinaraColor.charcoal)

            Spacer(minLength: 0)

            Button("Değiştir") { model.goBack() }
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.sageDeep)
        }
        .padding(.horizontal, KlinaraMetrics.md)
        .padding(.vertical, KlinaraMetrics.sm + 2)
        .background(KlinaraColor.sageSoft)
        .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
    }
}

#Preview {
    let model = AuthFlowModel(services: .mock())
    model.phoneE164 = "+905321234567"
    return PasswordView(model: model)
}
