import SwiftUI

/// Telefon doğrulama — SMS ile 6 haneli kod.
///
/// Doğrulanmamış numara bir kimlik değil, yalnız bir iletişim alanıdır;
/// giriş tanımlayıcısı olabilmesi için önce doğrulanması gerekir.
///
/// **SMS bir giriş faktörü değildir** — yalnız numarayı doğrular. İspat
/// passkey veya paroladan gelir.
struct PhoneVerificationView: View {

    @Bindable var model: AuthFlowModel

    @State private var now = Date()
    @State private var lastSentAt: Date?

    /// Yeniden gönderim kilidi. SMS paralıdır; sınırsız gönderim ucu
    /// doğrudan faturaya yazılan bir kötüye kullanım hedefidir.
    private let resendCooldown: TimeInterval = 60

    private var secondsUntilResend: Int {
        guard let lastSentAt else { return 0 }
        return max(0, Int(resendCooldown - now.timeIntervalSince(lastSentAt).rounded(.down)))
    }

    private var codeExpired: Bool {
        guard let expiry = model.phoneCodeExpiresAt else { return false }
        return now >= expiry
    }

    var body: some View {
        AuthScaffold(
            eyebrow: "Doğrulama",
            title: "Numaranızı doğrulayın",
            subtitle: subtitle
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let error = model.error {
                    ErrorBanner(error: error)
                }

                if model.phoneCodeExpiresAt != nil {
                    OTPCodeField(
                        code: $model.smsCode,
                        hasError: model.error != nil
                    ) { _ in
                        submit()
                    }

                    expiryNotice
                }
            }
        } actions: {
            if model.phoneCodeExpiresAt == nil {
                KlinaraButton(title: "Kod gönder", isLoading: model.isBusy) {
                    send()
                }
            } else {
                KlinaraButton(
                    title: "Doğrula",
                    isLoading: model.isBusy,
                    isEnabled: model.smsCode.count == 6 && !codeExpired
                ) {
                    submit()
                }

                KlinaraButton(
                    title: resendTitle,
                    kind: .tertiary,
                    isEnabled: secondsUntilResend == 0
                ) {
                    send()
                }
            }
        }
        .task {
            // Geri sayım sunucudan gelen `expiresAt` ile sürülür;
            // istemci tarafında ayrı bir 5 dakika sayacı tutulmaz.
            while !Task.isCancelled {
                now = Date()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private var subtitle: String {
        let phone = model.profile?.user.phone.map(PhoneNumberField.pretty) ?? ""
        return model.phoneCodeExpiresAt == nil
            ? "\(phone) numarasına 6 haneli bir kod göndereceğiz."
            : "\(phone) numarasına gönderilen kodu girin."
    }

    private var resendTitle: String {
        secondsUntilResend == 0
            ? "Kodu tekrar gönder"
            : "Tekrar gönder (\(secondsUntilResend) sn)"
    }

    @ViewBuilder
    private var expiryNotice: some View {
        if codeExpired {
            Label("Kodun süresi doldu. Yeni bir kod isteyin.", systemImage: "clock.badge.exclamationmark")
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.danger)
        } else if let expiry = model.phoneCodeExpiresAt {
            // Tek bir Text: ayrı Text'lerden kurulu bir HStack satır kıramaz
            // ve büyük punto boylarında kırpılır.
            Label {
                Text("Kod \(expiry, style: .timer) içinde geçerli")
            } icon: {
                Image(systemName: "clock")
            }
            .klinaraText(.bodyM)
            .foregroundStyle(KlinaraColor.charcoalMuted)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func send() {
        lastSentAt = Date()
        model.smsCode = ""
        Task { await model.sendPhoneCode() }
    }

    private func submit() {
        guard model.smsCode.count == 6, !codeExpired, !model.isBusy else { return }
        Task { await model.submitPhoneCode() }
    }
}

#Preview {
    PhoneVerificationView(model: AuthFlowModel(auth: MockAuthService(scenario: .unverifiedPhone)))
}
