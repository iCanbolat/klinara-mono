import SwiftUI

/// Doğrulama cihazına erişemeyen kullanıcı için yedek kod girişi.
///
/// Sunucu tarafında ayrı bir uç yoktur: aynı `POST /auth/2fa/verify`
/// çağrısı hem TOTP hem yedek kodu kabul eder.
struct BackupCodeEntryView: View {

    @Bindable var model: AuthFlowModel

    var body: some View {
        AuthScaffold(
            eyebrow: "İki adımlı doğrulama",
            title: "Yedek kod",
            subtitle: "Kurulum sırasında kaydettiğiniz kodlardan birini girin.",
            onBack: { model.goBack() }
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                if let error = model.error {
                    ErrorBanner(error: error)
                }

                KlinaraTextField(
                    label: "Yedek kod",
                    text: $model.backupCode,
                    placeholder: "xxxx-xxxx",
                    submitLabel: .go
                ) {
                    submit()
                }

                Label(
                    "Her yedek kod yalnızca bir kez kullanılabilir.",
                    systemImage: "info.circle"
                )
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoalMuted)
            }
        } actions: {
            KlinaraButton(
                title: "Doğrula",
                isLoading: model.isBusy,
                isEnabled: model.backupCode.count >= 8
            ) {
                submit()
            }

            KlinaraButton(title: "Doğrulama kodu kullan", kind: .tertiary) {
                model.useAuthenticatorCode()
            }
        }
    }

    private func submit() {
        guard model.backupCode.count >= 8, !model.isBusy else { return }
        Task { await model.submitBackupCode() }
    }
}

#Preview {
    BackupCodeEntryView(model: AuthFlowModel(services: .mock()))
}
