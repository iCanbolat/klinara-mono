import SwiftUI

/// İkinci faktör: doğrulama uygulamasındaki 6 haneli kod.
///
/// Passkey ile girişte bu ekran **hiç** görünmez — passkey tek adımda iki
/// faktör sağlar (cihaza sahip olmak + biyometri).
struct TOTPView: View {

    @Bindable var model: AuthFlowModel

    var body: some View {
        AuthScaffold(
            eyebrow: "İki adımlı doğrulama",
            title: "Doğrulama kodu",
            subtitle: "Doğrulama uygulamanızdaki 6 haneli kodu girin.",
            onBack: { model.goBack() }
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let error = model.error {
                    ErrorBanner(error: error)
                }

                OTPCodeField(
                    code: $model.mfaCode,
                    hasError: model.error != nil
                ) { _ in
                    submit()
                }
            }
        } actions: {
            KlinaraButton(
                title: "Doğrula",
                isLoading: model.isBusy,
                isEnabled: model.mfaCode.count == 6
            ) {
                submit()
            }

            if model.mfaChallenge?.allowsBackupCode == true {
                KlinaraButton(title: "Yedek kod kullan", kind: .tertiary) {
                    model.useBackupCode()
                }
            }
        }
    }

    private func submit() {
        guard model.mfaCode.count == 6, !model.isBusy else { return }
        Task { await model.submitMfaCode() }
    }
}

#Preview {
    TOTPView(model: AuthFlowModel(auth: MockAuthService()))
}
