import SwiftUI

/// Seçilebilir çip ızgarası — slot seçici, gün seçici, etiket filtresi.
///
/// `ScheduleExceptionEditorView` içindeki elle yazılmış gün çipleri buradan
/// genelleştirildi. Ayrı ayrı kopyalanan bir kontrol, birinde 44pt hedefi
/// tutturulup diğerinde tutturulmaması demekti.
///
/// Yerleşim mevcut ``FlowLayout`` üzerinde: satır dolduğunda alta sarar,
/// böylece çip sayısı önceden bilinmeyen listeler (uygunluk slotları) taşmaz.
struct KlinaraChipGrid<Value: Hashable & Identifiable>: View {

    let options: [Value]
    let title: (Value) -> String
    let isSelected: (Value) -> Bool
    var isEnabled: (Value) -> Bool = { _ in true }
    /// Seçili çipin sağ üstünde gösterilecek küçük rozet (örn. "2 kişi").
    var badge: ((Value) -> String?)?
    let onTap: (Value) -> Void

    var body: some View {
        FlowLayout(spacing: KlinaraMetrics.sm) {
            ForEach(options) { option in
                chip(option)
            }
        }
    }

    @ViewBuilder
    private func chip(_ option: Value) -> some View {
        let selected = isSelected(option)
        let enabled = isEnabled(option)

        Button {
            onTap(option)
        } label: {
            VStack(spacing: 1) {
                Text(title(option))
                    .klinaraText(.button)
                if let badge, let text = badge(option) {
                    Text(text)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(
                            selected ? KlinaraColor.surfaceRaised.opacity(0.8)
                                     : KlinaraColor.charcoalMuted
                        )
                }
            }
            .foregroundStyle(foreground(selected: selected, enabled: enabled))
            .padding(.horizontal, KlinaraMetrics.md)
            .frame(minWidth: 76, minHeight: 44)
            .background(background(selected: selected, enabled: enabled))
            .overlay(
                RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius)
                    .stroke(
                        selected ? KlinaraColor.sageDeep : KlinaraColor.border,
                        lineWidth: KlinaraMetrics.borderWidth
                    )
            )
            .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    private func foreground(selected: Bool, enabled: Bool) -> Color {
        if !enabled { return KlinaraColor.charcoalMuted.opacity(0.5) }
        return selected ? KlinaraColor.surfaceRaised : KlinaraColor.charcoal
    }

    private func background(selected: Bool, enabled: Bool) -> Color {
        if !enabled { return KlinaraColor.disabled }
        return selected ? KlinaraColor.sageDeep : KlinaraColor.surfaceRaised
    }
}

#Preview("Çip ızgarası") {
    @Previewable @State var picked = Weekday.monday
    return KlinaraChipGrid(
        options: Weekday.displayOrder,
        title: \.shortName,
        isSelected: { $0 == picked },
        badge: { $0 == .saturday ? "yarım gün" : nil },
        onTap: { picked = $0 }
    )
    .padding(KlinaraMetrics.screenInset)
    .background(KlinaraColor.surface)
}
