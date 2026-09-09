import SwiftUI

/// Günün zaman ızgarası — dakika bazlı y-ekseni üzerine yerleşen bloklar.
///
/// Ajandanın söylemediğini söyler: **boşluk nerede**. "14:00'e sığar mı?"
/// sorusunun cevabı listede sayarak, ızgarada bakarak verilir.
///
/// Çakışan bloklar yan yana bölünür. Sunucu aynı personele çakışan randevu
/// yazdırmıyor ama farklı personellerin randevuları aynı saatte olabilir ve
/// üst üste çizmek ikisini de okunamaz kılardı.
struct DayGridView: View {

    let clock: BranchClock
    let day: Date
    let entries: [CalendarEntry]
    let staffColor: (String) -> String?
    let onSelect: (CalendarEntry) -> Void

    private var hours: Range<Int> {
        CalendarBlockLayout.hours(for: entries, clock: clock)
    }

    private var gridHeight: CGFloat {
        CGFloat(hours.count) * CalendarGridMetrics.hourHeight
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ZStack(alignment: .topLeading) {
                TimeAxisRuler(hours: hours)

                blocks
                    .padding(.leading, CalendarGridMetrics.rulerWidth + KlinaraMetrics.xs)

                if clock.isToday(day), let offset = nowOffset {
                    NowIndicator()
                        .padding(.leading, CalendarGridMetrics.rulerWidth - 4)
                        .offset(y: offset)
                }
            }
            .frame(height: gridHeight, alignment: .top)
        }
    }

    private var nowOffset: CGFloat? {
        let minutes = clock.minutesFromMidnight(Date()) - hours.lowerBound * 60
        guard minutes >= 0, minutes <= hours.count * 60 else { return nil }
        return CalendarGridMetrics.offset(minutesFromMidnight: minutes)
    }

    private var blocks: some View {
        GeometryReader { proxy in
            ForEach(
                CalendarBlockLayout.place(
                    entries: entries,
                    clock: clock,
                    originMinutes: hours.lowerBound * 60,
                    width: proxy.size.width
                )
            ) { placed in
                block(placed)
                    .frame(width: placed.width)
                    .offset(x: placed.x, y: placed.y)
            }
        }
    }

    private func block(_ placed: CalendarBlockLayout.Placed) -> some View {
        Button {
            onSelect(placed.entry)
        } label: {
            AppointmentBlockView(
                title: placed.entry.customerName,
                subtitle: placed.entry.serviceSummary,
                // Yalnız saat: gün zaten ekranın başlığı ve ızgaranın kendisi.
                // Tam tarih, blokta hizmet adına yer bırakmıyordu.
                timeRange: "\(clock.formatTime(placed.entry.startsAt)) – "
                    + clock.formatTime(placed.entry.endsAt),
                colorHex: placed.entry.services.first.flatMap { staffColor($0.staffProfileId) },
                status: placed.entry.status.turkishName,
                isTerminal: placed.entry.status.isTerminal,
                height: placed.height
            )
        }
        .buttonStyle(.plain)
    }
}
