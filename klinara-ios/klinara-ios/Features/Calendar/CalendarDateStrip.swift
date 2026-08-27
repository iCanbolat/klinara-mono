import SwiftUI

/// Yatay gün seçici — takvimin üstündeki hafta şeridi.
///
/// `DatePicker` yerine şerit olmasının sebebi: klinikte en sık yapılan gezinme
/// "yarın", "önceki gün" ve "haftanın şu günü". Takvim açıp gün seçtirmek,
/// tek dokunuşluk bir işi üç dokunuşa çıkarırdı. Uzun tarih atlamaları için
/// başlıktaki tarih düğmesi hâlâ takvim açar.
struct CalendarDateStrip: View {

    let clock: BranchClock
    let selected: Date
    /// Gün → o gün için randevu sayısı; şeridin altındaki nokta bundan çizilir.
    var counts: [String: Int] = [:]
    let onSelect: (Date) -> Void

    private var days: [Date] { clock.weekDays(of: selected) }

    var body: some View {
        HStack(spacing: KlinaraMetrics.xs) {
            ForEach(days, id: \.timeIntervalSince1970) { day in
                dayButton(day)
            }
        }
    }

    private func dayButton(_ day: Date) -> some View {
        let isSelected = clock.isSameDay(day, selected)
        let isToday = clock.isToday(day)
        let count = counts[clock.localDateString(day)] ?? 0

        return Button {
            onSelect(day)
        } label: {
            VStack(spacing: 2) {
                Text(weekdayLabel(day))
                    .font(.system(size: 10, weight: .semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(
                        isSelected ? KlinaraColor.surfaceRaised : KlinaraColor.charcoalMuted
                    )

                Text(dayNumber(day))
                    .font(.system(size: 16, weight: isToday ? .bold : .medium))
                    .monospacedDigit()
                    .foregroundStyle(
                        isSelected ? KlinaraColor.surfaceRaised : KlinaraColor.charcoal
                    )

                Circle()
                    .fill(dotColor(count: count, isSelected: isSelected))
                    .frame(width: 4, height: 4)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(isSelected ? KlinaraColor.sageDeep : KlinaraColor.surfaceRaised)
            .overlay(
                RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius)
                    .stroke(
                        isToday && !isSelected ? KlinaraColor.sageDeep : KlinaraColor.border,
                        lineWidth: isToday && !isSelected ? 1.5 : KlinaraMetrics.borderWidth
                    )
            )
            .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(clock.formatDate(day) + (count > 0 ? ", \(count) randevu" : ", randevu yok"))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private func dotColor(count: Int, isSelected: Bool) -> Color {
        guard count > 0 else { return .clear }
        return isSelected ? KlinaraColor.surfaceRaised.opacity(0.8) : KlinaraColor.sage
    }

    private func weekdayLabel(_ day: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "tr_TR")
        formatter.timeZone = clock.timeZone
        formatter.dateFormat = "EEEEE"
        return formatter.string(from: day)
    }

    private func dayNumber(_ day: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "tr_TR")
        formatter.timeZone = clock.timeZone
        formatter.dateFormat = "d"
        return formatter.string(from: day)
    }
}
