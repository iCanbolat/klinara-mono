import SwiftUI

/// Marka buton stilleri.
///
/// - `primary`: dolu sage — ekranda **tek** birincil aksiyon olur.
/// - `secondary`: kenarlıklı — eşdeğer ağırlıkta alternatif.
/// - `tertiary`: düz metin — "vazgeç", "daha sonra", yardımcı yollar.
enum KlinaraButtonKind {
    case primary, secondary, tertiary
}

struct KlinaraButton: View {

    let title: String
    var kind: KlinaraButtonKind = .primary
    var icon: String?
    var isLoading = false
    var isEnabled = true
    let action: () -> Void

    private var interactive: Bool { isEnabled && !isLoading }

    var body: some View {
        Button(action: action) {
            ZStack {
                // İçerik yüklenirken de yerinde durur: buton yüksekliği
                // değişmez, altındaki düzen zıplamaz.
                content.opacity(isLoading ? 0 : 1)

                if isLoading {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(spinnerTint)
                }
            }
            .frame(maxWidth: .infinity)
            // Sabit yükseklik DEĞİL: erişilebilirlik punto boylarında etiket
            // iki satıra taşabilir ve sabit yükseklikte kırpılır.
            .frame(minHeight: kind == .tertiary ? 44 : KlinaraMetrics.controlHeight)
            .padding(.vertical, KlinaraMetrics.xs)
            .background(background)
            .overlay(border)
            .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
            .contentShape(.rect)
        }
        .buttonStyle(PressableButtonStyle(enabled: interactive))
        .disabled(!interactive)
        .animation(KlinaraMetrics.feedback, value: isLoading)
        .animation(KlinaraMetrics.feedback, value: isEnabled)
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isButton)
    }

    private var content: some View {
        HStack(spacing: KlinaraMetrics.sm) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .medium))
            }
            Text(title)
                .klinaraText(.button)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.75)
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, KlinaraMetrics.sm)
    }

    // MARK: Görünüm

    private var foreground: Color {
        guard isEnabled else { return KlinaraColor.charcoalMuted }
        return switch kind {
        case .primary: KlinaraColor.surfaceRaised
        case .secondary: KlinaraColor.charcoal
        case .tertiary: KlinaraColor.sageDeep
        }
    }

    private var spinnerTint: Color {
        kind == .primary ? KlinaraColor.surfaceRaised : KlinaraColor.sage
    }

    @ViewBuilder
    private var background: some View {
        switch kind {
        case .primary:
            (isEnabled ? KlinaraColor.sage : KlinaraColor.disabled)
        case .secondary:
            KlinaraColor.surfaceRaised
        case .tertiary:
            Color.clear
        }
    }

    @ViewBuilder
    private var border: some View {
        if kind == .secondary {
            RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius)
                .stroke(
                    isEnabled ? KlinaraColor.border : KlinaraColor.disabled,
                    lineWidth: KlinaraMetrics.borderWidth
                )
        }
    }
}

/// Basıldığında hafifçe söner. Ölçek animasyonu yok — marka kişiliği sakin.
private struct PressableButtonStyle: ButtonStyle {
    let enabled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed && enabled ? 0.72 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

#Preview("Butonlar") {
    VStack(spacing: KlinaraMetrics.md) {
        KlinaraButton(title: "Devam et") {}
        KlinaraButton(title: "Face ID ile giriş", kind: .secondary, icon: "faceid") {}
        KlinaraButton(title: "Daha sonra", kind: .tertiary) {}
        KlinaraButton(title: "Gönderiliyor", isLoading: true) {}
        KlinaraButton(title: "Devam et", isEnabled: false) {}
    }
    .padding(KlinaraMetrics.screenInset)
    .background(KlinaraColor.surface)
}
