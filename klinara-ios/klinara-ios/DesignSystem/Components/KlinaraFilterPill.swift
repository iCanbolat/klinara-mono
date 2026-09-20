import SwiftUI

/// Yatay kaydırılan filtre satırlarının hapı — takvimde personel, müşterilerde etiket.
/// Android `KlinaraFilterPill` paritesi.
struct KlinaraFilterPill: View {

    let title: String
    let isSelected: Bool
    /// Etiket ya da personel rengi. Tek başına anlam taşımaz; yanında daima ad var.
    var dotColor: Color?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let dotColor {
                    Circle().fill(dotColor).frame(width: 8, height: 8)
                }
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(isSelected ? KlinaraColor.surfaceRaised : KlinaraColor.charcoal)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .background(isSelected ? KlinaraColor.sageDeep : KlinaraColor.surfaceRaised)
            .overlay(
                Capsule().stroke(
                    isSelected ? KlinaraColor.sageDeep : KlinaraColor.border,
                    lineWidth: KlinaraMetrics.borderWidth
                )
            )
            .clipShape(.capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}
