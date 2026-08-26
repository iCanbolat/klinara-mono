import SwiftUI

/// Ekran seviyesindeki hata bildirimi.
///
/// Alan bazlı doğrulama hataları input'un altında (`FieldErrorText`) durur;
/// bu bileşen ağ, hız sınırı ve hesap durumu gibi **ekran seviyesindeki**
/// hatalar içindir.
struct ErrorBanner: View {

    let error: AuthError
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: KlinaraMetrics.sm) {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(KlinaraColor.danger)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
                Text(error.displayMessage)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .fixedSize(horizontal: false, vertical: true)

                // Destek talebinde kullanıcının bize verebileceği iz.
                if let reference = error.supportReference {
                    Text("Referans: \(reference)")
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .textSelection(.enabled)
                }

                if error.isRetryable, let onRetry {
                    Button("Tekrar dene", action: onRetry)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.sageDeep)
                        .padding(.top, KlinaraMetrics.xs)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(KlinaraMetrics.md)
        .background(KlinaraColor.danger.opacity(0.08))
        .overlay(
            RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius)
                .stroke(KlinaraColor.danger.opacity(0.35), lineWidth: KlinaraMetrics.borderWidth)
        )
        .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
        .transition(.opacity.combined(with: .move(edge: .top)))
        .accessibilityElement(children: .combine)
    }
}

/// Passkey sistem sheet'i ve diğer engelleyici işlemler sırasında görünen katman.
struct AuthLoadingOverlay: View {
    var message: String

    var body: some View {
        ZStack {
            KlinaraColor.surface.opacity(0.86)
                .ignoresSafeArea()

            VStack(spacing: KlinaraMetrics.md) {
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(KlinaraColor.sage)
                    .controlSize(.large)

                Text(message)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
        }
        .transition(.opacity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(message)
    }
}

#Preview("Hata") {
    VStack(spacing: KlinaraMetrics.md) {
        ErrorBanner(error: .network, onRetry: {})
        ErrorBanner(error: .problem(ProblemDetails(
            code: .accountLocked, title: "Kilitli", detail: nil, status: 423, requestId: nil
        )))
        ErrorBanner(error: .problem(ProblemDetails(
            code: .internalError, title: "Hata", detail: nil, status: 500, requestId: "01JQABCD"
        )))
    }
    .padding(KlinaraMetrics.screenInset)
    .background(KlinaraColor.surface)
}
