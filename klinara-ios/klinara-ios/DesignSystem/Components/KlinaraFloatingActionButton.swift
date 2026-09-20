import SwiftUI

/// Ekranın birincil "oluştur" aksiyonu — sağ altta, sekme çubuğunun üstünde.
///
/// Gezinme çubuğundaki "+" şube seçici ve başlıkla aynı dar alanı paylaşıyordu;
/// FAB hem iOS hem Android'de aynı yerde, başparmak erişiminde duruyor.
struct KlinaraFloatingActionButton: View {

    let accessibilityLabel: String
    var systemImage = "plus"
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            KlinaraFABLabel(systemImage: systemImage)
        }
        .buttonStyle(FABPressStyle())
        .accessibilityLabel(accessibilityLabel)
    }
}

/// FAB'ın görünümü — `Menu` etiketi olarak da kullanılıyor (Personel: davet et / yeni personel).
struct KlinaraFABLabel: View {

    var systemImage = "plus"

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(KlinaraColor.surfaceRaised)
            .frame(width: Self.size, height: Self.size)
            .background(KlinaraColor.sageDeep, in: .circle)
            .shadow(color: .black.opacity(0.18), radius: 8, y: 4)
            .contentShape(.circle)
    }

    static let size: CGFloat = 56
}

private struct FABPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.72 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension View {

    /// Sağ alta FAB yerleştirir. `safeAreaInset` kullanılıyor: kaydırılan içerik FAB'ın
    /// altına kadar uzanır ama son satır FAB'ın arkasında kalmaz.
    ///
    /// `isVisible` false ise hiçbir şey çizilmez — izni olmayan kullanıcıya
    /// dokunulduğunda 403 veren bir düğme gösterilmez.
    @ViewBuilder
    func klinaraFAB(
        isVisible: Bool = true,
        accessibilityLabel: String,
        systemImage: String = "plus",
        action: @escaping () -> Void
    ) -> some View {
        klinaraFAB(isVisible: isVisible) {
            KlinaraFloatingActionButton(
                accessibilityLabel: accessibilityLabel,
                systemImage: systemImage,
                action: action
            )
        }
    }

    /// Özel FAB içeriği (ör. `Menu { … } label: { KlinaraFABLabel() }`).
    @ViewBuilder
    func klinaraFAB<FAB: View>(isVisible: Bool = true, @ViewBuilder fab: () -> FAB) -> some View {
        if isVisible {
            safeAreaInset(edge: .bottom, alignment: .trailing, spacing: 0) {
                fab()
                    .padding(.trailing, KlinaraMetrics.md)
                    .padding(.bottom, KlinaraMetrics.md)
            }
        } else {
            self
        }
    }
}

#Preview("FAB") {
    List(0..<30) { Text("Satır \($0)") }
        .klinaraFAB(accessibilityLabel: "Yeni") {}
}
