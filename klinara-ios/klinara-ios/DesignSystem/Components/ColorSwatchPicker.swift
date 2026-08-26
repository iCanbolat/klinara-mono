import SwiftUI

/// Takvim rengi seçici.
///
/// Serbest renk seçici **bilinçli olarak kullanılmıyor**: takvimde yan yana
/// duracak renklerin birbirinden ayırt edilebilir olması gerekir ve kullanıcıya
/// bırakıldığında iki hizmet neredeyse aynı tonu alır. Palet, marka ile uyumlu
/// ve birbirinden ayrışan tonlardan oluşur.
struct ColorSwatchPicker: View {

    let label: String
    /// `#RRGGBB` — sunucunun `COLOR_PATTERN`'i başka biçim kabul etmez.
    @Binding var hex: String?
    var allowsClearing = true

    /// Takvimde ayırt edilebilirlik için seçilmiş sekiz ton.
    static let palette = [
        "#7F9A76", "#5E7856", "#1A6A7A", "#3F6E8C",
        "#8C6A3F", "#A6483C", "#7A5A8C", "#4A4F52",
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            Text(label)
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.charcoalMuted)

            HStack(spacing: KlinaraMetrics.sm) {
                ForEach(Self.palette, id: \.self) { swatch in
                    swatchButton(swatch)
                }

                if allowsClearing {
                    Button {
                        hex = nil
                    } label: {
                        ZStack {
                            Circle()
                                .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
                            Image(systemName: "slash.circle")
                                .font(.system(size: 14))
                                .foregroundStyle(KlinaraColor.charcoalMuted)
                        }
                        .frame(width: 30, height: 30)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Rengi kaldır")
                }
            }
        }
    }

    private func swatchButton(_ swatch: String) -> some View {
        let isSelected = hex?.uppercased() == swatch.uppercased()
        return Button {
            hex = swatch
        } label: {
            Circle()
                .fill(Color(hex: swatch) ?? KlinaraColor.border)
                .frame(width: 30, height: 30)
                .overlay(
                    Circle()
                        .stroke(
                            isSelected ? KlinaraColor.charcoal : KlinaraColor.border,
                            lineWidth: isSelected ? 2 : KlinaraMetrics.borderWidth
                        )
                )
                .overlay {
                    if isSelected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Renk \(swatch)")
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

#Preview("Renk seçici") {
    @Previewable @State var hex: String? = "#1A6A7A"
    return ColorSwatchPicker(label: "Takvim rengi", hex: $hex)
        .padding(KlinaraMetrics.screenInset)
        .background(KlinaraColor.surface)
}
