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

    /// Izgaranın kapsadığı saatler. Randevular dışarı taşarsa aralık genişler —
    /// sabit 09–19 penceresi, 08:30'daki bir randevuyu görünmez kılardı.
    private var hours: Range<Int> {
        let starts = entries.map { clock.minutesFromMidnight($0.startsAt) / 60 }
        let ends = entries.map { (clock.minutesFromMidnight($0.endsAt) + 59) / 60 }
        let lower = min(starts.min() ?? 9, 9)
        let upper = max(ends.max() ?? 19, 19)
        return lower..<max(upper, lower + 1)
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
            ForEach(layout(width: proxy.size.width), id: \.entry.id) { placed in
                block(placed)
                    .frame(width: placed.width)
                    .offset(x: placed.x, y: placed.y)
            }
        }
    }

    private func block(_ placed: Placed) -> some View {
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

    // MARK: Yerleşim

    private struct Placed {
        let entry: CalendarEntry
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat
    }

    /// Çakışan blokları kümelere ayırıp her kümeyi eşit sütunlara böler.
    ///
    /// Sonlanmış randevular kümeye **katılmaz**: iptal edilmiş bir randevu
    /// slotu bırakmıştır, yerini tutan bir sütun ayırmak yanıltıcı olurdu.
    private func layout(width: CGFloat) -> [Placed] {
        let ordered = entries.sorted { $0.startsAt < $1.startsAt }
        let origin = hours.lowerBound * 60
        var result: [Placed] = []
        var cluster: [CalendarEntry] = []
        var clusterEnd: Date?

        func flush() {
            guard !cluster.isEmpty else { return }
            let columns = max(cluster.count, 1)
            let columnWidth = (width - KlinaraMetrics.sm) / CGFloat(columns)
            for (index, entry) in cluster.enumerated() {
                let start = clock.minutesFromMidnight(entry.startsAt) - origin
                let minutes = max(clock.minutes(from: entry.startsAt, to: entry.endsAt), 15)
                result.append(Placed(
                    entry: entry,
                    x: CGFloat(index) * columnWidth,
                    y: CalendarGridMetrics.offset(minutesFromMidnight: start),
                    width: columnWidth - 2,
                    height: CalendarGridMetrics.height(minutes: minutes)
                ))
            }
            cluster = []
            clusterEnd = nil
        }

        for entry in ordered {
            if entry.status.isTerminal {
                // Kümeye katmadan, tek sütun genişliğinde ve soluk çizilir.
                let start = clock.minutesFromMidnight(entry.startsAt) - origin
                let minutes = max(clock.minutes(from: entry.startsAt, to: entry.endsAt), 15)
                result.append(Placed(
                    entry: entry,
                    x: 0,
                    y: CalendarGridMetrics.offset(minutesFromMidnight: start),
                    width: width - KlinaraMetrics.sm,
                    height: CalendarGridMetrics.height(minutes: minutes)
                ))
                continue
            }
            if let end = clusterEnd, entry.startsAt >= end { flush() }
            cluster.append(entry)
            clusterEnd = max(clusterEnd ?? entry.endsAt, entry.endsAt)
        }
        flush()
        return result
    }
}
