import SwiftUI

/// Girişin ilk adımı: kim olduğunuz.
///
/// Mobilin birincil tanımlayıcısı **telefondur**; birincil faktör passkey.
/// Bu cihazda daha önce passkey kaydedildiyse biyometri butonu öne çıkar ve
/// telefon alanı ikincil hâle gelir — günde onlarca kez uygulamaya dönen
/// uygulayıcı için tek dokunuş yeterli olmalı.
struct IdentifierView: View {

    @Bindable var model: AuthFlowModel
    /// Geliştirici senaryo seçici — yalnız mock servis kullanılırken.
    var mock: MockAuthService?

    @State private var showsDeveloperSheet = false

    var body: some View {
        AuthScaffold(
            eyebrow: "Giriş",
            title: "Tekrar hoş geldiniz",
            subtitle: subtitle,
            showsLogo: true
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                if let error = model.error {
                    ErrorBanner(error: error)
                }

                if model.offersPasskeyShortcut {
                    passkeyShortcut
                    separator
                }

                identifierField
            }
        } actions: {
            KlinaraButton(
                title: "Devam et",
                isLoading: model.isBusy,
                isEnabled: model.canSubmitIdentifier
            ) {
                model.submitIdentifier()
            }

            KlinaraButton(title: alternateModeTitle, kind: .tertiary) {
                model.switchIdentifierMode()
            }
        }
        .animation(KlinaraMetrics.feedback, value: model.identifierMode)
        // Logoya uzun basmak senaryo seçiciyi açar. Giriş ekranından da
        // erişilebilir olması şart: "hatalı bilgi" senaryosunda ana ekrana
        // hiç ulaşılamaz, dolayısıyla oradaki menü işe yaramaz.
        .overlay(alignment: .topLeading) {
            if mock != nil {
                Color.clear
                    .frame(width: 72, height: 72)
                    .contentShape(.rect)
                    .onLongPressGesture(minimumDuration: 0.8) {
                        showsDeveloperSheet = true
                    }
                    .padding(.leading, KlinaraMetrics.screenInset)
                    .padding(.top, 56)
                    .accessibilityHidden(true)
            }
        }
        .sheet(isPresented: $showsDeveloperSheet) {
            if let mock {
                DeveloperScenarioSheet(mock: mock) { scenario in
                    mock.scenario = scenario
                    PasskeyRegistry.hasEnrolledPasskey = (scenario == .happyPasskey)
                    model.resetForScenarioChange()
                }
            }
        }
    }

    private var subtitle: String {
        model.offersPasskeyShortcut
            ? "\(model.biometry.displayName) ile tek dokunuşta girin ya da numaranızla devam edin."
            : "Kliniğinize kayıtlı telefon numaranızla devam edin."
    }

    private var alternateModeTitle: String {
        model.identifierMode == .phone ? "E-posta ile giriş" : "Telefon ile giriş"
    }

    // MARK: Parçalar

    private var passkeyShortcut: some View {
        KlinaraButton(
            title: "\(model.biometry.displayName) ile giriş",
            kind: .secondary,
            icon: model.biometry.symbolName
        ) {
            Task { await model.signInWithPasskey() }
        }
    }

    private var separator: some View {
        HStack(spacing: KlinaraMetrics.md) {
            line
            Text("veya")
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.charcoalMuted)
            line
        }
        .padding(.vertical, KlinaraMetrics.xs)
    }

    private var line: some View {
        Rectangle()
            .fill(KlinaraColor.border)
            .frame(height: 1)
    }

    @ViewBuilder
    private var identifierField: some View {
        if model.identifierMode == .phone {
            PhoneNumberField(
                label: "Telefon numarası",
                e164: $model.phoneE164
            ) {
                if model.canSubmitIdentifier { model.submitIdentifier() }
            }
        } else {
            KlinaraTextField(
                label: "E-posta",
                text: $model.email,
                placeholder: "ornek@klinik.com",
                textContentType: .emailAddress,
                keyboardType: .emailAddress
            ) {
                if model.canSubmitIdentifier { model.submitIdentifier() }
            }
        }
    }
}

#Preview("Telefon") {
    IdentifierView(model: AuthFlowModel(auth: MockAuthService()))
}
