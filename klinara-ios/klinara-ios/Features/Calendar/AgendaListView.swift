import SwiftUI

/// Günün randevuları, saate göre sıralı liste.
///
/// Izgaranın aksine ajanda **boşlukları göstermez**: telefonda dikeyde yer
/// kıymetli ve günün çoğu saati boşken kullanıcı boş ızgaraya bakıyor. İki
/// görünüm arasında geçiş bu yüzden var.
struct AgendaListView: View {

    let clock: BranchClock
    let active: [CalendarEntry]
    let terminal: [CalendarEntry]
    let staffColor: (String) -> String?
    let onSelect: (CalendarEntry) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
            if active.isEmpty && terminal.isEmpty {
                EmptyStateView(
                    icon: "calendar",
                    title: "Bu günde randevu yok",
                    message: "Sağ üstteki artı ile yeni randevu oluşturabilirsiniz."
                )
                .frame(minHeight: 220)
            }

            if !active.isEmpty {
                KlinaraCard {
                    ForEach(Array(active.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { KlinaraDivider() }
                        row(entry)
                    }
                }
            }

            if !terminal.isEmpty {
                // İptal edilenler kaybolmaz, ayrı bir başlık altına düşer:
                // görünmez olsalardı "ben bunu iptal etmiş miydim?" sorusu kalırdı.
                KlinaraCard(title: "İptal ve gelmeyenler") {
                    ForEach(Array(terminal.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { KlinaraDivider() }
                        row(entry)
                    }
                }
            }
        }
    }

    private func row(_ entry: CalendarEntry) -> some View {
        Button {
            onSelect(entry)
        } label: {
            HStack(alignment: .top, spacing: KlinaraMetrics.md) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(clock.formatTime(entry.startsAt))
                        .klinaraText(.bodyEmphasis)
                        .monospacedDigit()
                    Text(clock.formatTime(entry.endsAt))
                        .font(.system(size: 11))
                        .monospacedDigit()
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
                .frame(width: 46, alignment: .leading)

                ColorDot(hex: entry.services.first.flatMap { staffColor($0.staffProfileId) })
                    .padding(.top, 3)

                VStack(alignment: .leading, spacing: 3) {
                    Text(entry.customerName)
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .strikethrough(entry.status.isTerminal)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text(entry.serviceSummary)
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    KlinaraBadge(text: entry.status.turkishName, tone: entry.status.badgeTone)
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .padding(.top, 3)
            }
            .padding(KlinaraMetrics.md)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(clock.formatRange(from: entry.startsAt, to: entry.endsAt)), "
                + "\(entry.customerName), \(entry.serviceSummary), \(entry.status.turkishName)"
        )
    }
}
