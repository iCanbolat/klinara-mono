import SwiftUI

/// Uygun saatler — sabah / öğleden sonra / akşam gruplarında, eşit sütunlu ızgara.
///
/// `KlinaraChipGrid`in `FlowLayout`u burada kullanılmıyor: çipler en az 76pt
/// genişlikte sarıyordu ve iPhone'da satır başına 3 çip + sağda boş bir sütun
/// kalıyordu. Saatler aynı genişlikte metinler; eşit sütunlu bir ızgara hem
/// kenardan kenara dolduruyor hem de gözün sütun boyunca taramasını sağlıyor.
struct BookingSlotGrid: View {

    let groups: [BookingAvailabilityPresentation.SlotGroup]
    let clock: BranchClock
    let isSelected: (AvailabilitySlot) -> Bool
    let onTap: (AvailabilitySlot) -> Void

    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: KlinaraMetrics.sm),
        count: 4
    )

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
                    HStack(spacing: 4) {
                        Text(group.period.title.uppercased(with: Locale(identifier: "tr_TR")))
                            .klinaraText(.label)
                        Text("· \(group.slots.count)")
                            .klinaraText(.label)
                            .monospacedDigit()
                    }
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)

                    LazyVGrid(columns: columns, spacing: KlinaraMetrics.sm) {
                        ForEach(group.slots) { slot in
                            chip(slot)
                        }
                    }
                }
            }
        }
    }

    private func chip(_ slot: AvailabilitySlot) -> some View {
        let selected = isSelected(slot)
        return Button {
            onTap(slot)
        } label: {
            VStack(spacing: 0) {
                Text(clock.formatTime(slot.startsAt))
                    .klinaraText(.button)
                    .monospacedDigit()
                // Birden çok aday: kimin atanacağı slota göre değişir; küçük bir
                // ipucu, personel seçmeden önce esnekliği gösteriyor.
                if slot.staffProfileIds.count > 1 {
                    Text("\(slot.staffProfileIds.count) kişi")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(
                            selected ? KlinaraColor.surfaceRaised.opacity(0.8) : KlinaraColor.charcoalMuted
                        )
                }
            }
            .foregroundStyle(selected ? KlinaraColor.surfaceRaised : KlinaraColor.charcoal)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(selected ? KlinaraColor.sageDeep : KlinaraColor.surfaceRaised)
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
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

/// Slot listesi boşken nedeni: gün kuralı (tatil, kapalı…) ya da doluluk.
struct BookingEmptyDayView: View {

    let notice: BookingAvailabilityPresentation.Notice
    let onNextDay: () -> Void

    var body: some View {
        VStack(spacing: KlinaraMetrics.sm) {
            Image(systemName: notice.isDayRule ? "calendar.badge.minus" : "calendar.badge.exclamationmark")
                .font(.system(size: 24))
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .accessibilityHidden(true)
            Text(notice.title)
                .klinaraText(.bodyEmphasis)
                .foregroundStyle(KlinaraColor.charcoal)
                .multilineTextAlignment(.center)
            Text(notice.detail)
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .multilineTextAlignment(.center)
            if notice.suggestsNextDay {
                Button(action: onNextDay) {
                    Label("Sonraki gün", systemImage: "chevron.right")
                        .labelStyle(TrailingIconLabelStyle())
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.sageDeep)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, KlinaraMetrics.lg)
        .padding(.horizontal, KlinaraMetrics.md)
        .accessibilityElement(children: .contain)
    }
}

private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.title
            configuration.icon.font(.system(size: 13, weight: .semibold))
        }
    }
}
