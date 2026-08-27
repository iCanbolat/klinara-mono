import SwiftUI

/// İki–dört seçenek arasında geçiş — markalı `Picker(.segmented)` karşılığı.
///
/// Sistem segmented control'ü kendi tipografisini ve dolgu rengini dayatıyor;
/// takvim başlığında diğer kontrollerin yanında yabancı duruyordu. Dokunma
/// hedefi 44pt'nin altına düşmesin diye yükseklik sabit.
struct KlinaraSegmentedPicker<Value: Hashable & Identifiable>: View {

    let options: [Value]
    @Binding var selection: Value
    let title: (Value) -> String
    var icon: ((Value) -> String)?

    @Namespace private var highlight

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options) { option in
                Button {
                    selection = option
                } label: {
                    HStack(spacing: KlinaraMetrics.xs) {
                        if let icon {
                            Image(systemName: icon(option))
                                .font(.system(size: 12, weight: .semibold))
                        }
                        Text(title(option))
                            .klinaraText(.button)
                    }
                    .foregroundStyle(
                        selection == option ? KlinaraColor.sageDeep : KlinaraColor.charcoalMuted
                    )
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
                    .background {
                        if selection == option {
                            RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius - 4)
                                .fill(KlinaraColor.surfaceRaised)
                                .matchedGeometryEffect(id: "segment", in: highlight)
                        }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == option ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(KlinaraMetrics.xs)
        .background(KlinaraColor.border.opacity(0.3))
        .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
        .animation(KlinaraMetrics.feedback, value: selection)
    }
}

#Preview("Segmentli seçici") {
    @Previewable @State var mode = CalendarStore.Mode.agenda
    return KlinaraSegmentedPicker(
        options: CalendarStore.Mode.allCases,
        selection: $mode,
        title: \.turkishName,
        icon: \.icon
    )
    .padding(KlinaraMetrics.screenInset)
    .background(KlinaraColor.surface)
}
