import Foundation
import SwiftUI

/// Zaman ızgarasındaki blokların yerleşimi.
///
/// Gün ve hafta ızgarası **aynı** kuralı uygulamak zorunda: çakışan randevular
/// yan yana bölünür, sonlanmış olanlar kümeye katılmaz. İki ayrı kopya, bir
/// gün birinin çakışmayı üst üste çizmesi demekti — hafta görünümü yazılırken
/// ``DayGridView``deki özel kopya buraya taşındı.
enum CalendarBlockLayout {

    /// Yerleşmiş tek blok. Koordinatlar sütunun sol üstüne göredir.
    struct Placed: Identifiable {
        let entry: CalendarEntry
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        let height: CGFloat

        var id: String { entry.id }
    }

    /// Çakışan blokları kümelere ayırıp her kümeyi eşit sütunlara böler.
    ///
    /// Sonlanmış randevular kümeye **katılmaz**: iptal edilmiş bir randevu
    /// slotu bırakmıştır ve yerini tutan bir sütun ayırmak, dolu olmayan bir
    /// saati dolu göstermek olurdu. Tam genişlikte, soluk çizilirler.
    ///
    /// - Parameters:
    ///   - originMinutes: Izgaranın ilk saatinin gece yarısından uzaklığı.
    ///   - width: Sütunun (ya da günün) kullanılabilir genişliği.
    static func place(
        entries: [CalendarEntry],
        clock: BranchClock,
        originMinutes: Int,
        width: CGFloat,
        gutter: CGFloat = KlinaraMetrics.sm
    ) -> [Placed] {
        let ordered = entries.sorted { $0.startsAt < $1.startsAt }
        let usable = max(width - gutter, 1)
        var result: [Placed] = []
        var cluster: [CalendarEntry] = []
        var clusterEnd: Date?

        func geometry(_ entry: CalendarEntry) -> (y: CGFloat, height: CGFloat) {
            let start = clock.minutesFromMidnight(entry.startsAt) - originMinutes
            // 15 dakikanın altındaki bir randevu da dokunulabilir kalmalı.
            let minutes = max(clock.minutes(from: entry.startsAt, to: entry.endsAt), 15)
            return (
                CalendarGridMetrics.offset(minutesFromMidnight: start),
                CalendarGridMetrics.height(minutes: minutes)
            )
        }

        func flush() {
            guard !cluster.isEmpty else { return }
            let columns = max(cluster.count, 1)
            let columnWidth = usable / CGFloat(columns)
            for (index, entry) in cluster.enumerated() {
                let box = geometry(entry)
                result.append(Placed(
                    entry: entry,
                    x: CGFloat(index) * columnWidth,
                    y: box.y,
                    width: max(columnWidth - 2, 1),
                    height: box.height
                ))
            }
            cluster = []
            clusterEnd = nil
        }

        for entry in ordered {
            if entry.status.isTerminal {
                let box = geometry(entry)
                result.append(Placed(
                    entry: entry,
                    x: 0,
                    y: box.y,
                    width: usable,
                    height: box.height
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

    /// Izgaranın kapsayacağı saat aralığı.
    ///
    /// Sabit 09–19 penceresi 08:30'daki bir randevuyu görünmez kılardı; aralık
    /// randevular dışarı taştıkça genişler ama hiçbir zaman daralmaz — boş bir
    /// günün ızgarası da tanıdık görünmeli.
    static func hours(for entries: [CalendarEntry], clock: BranchClock) -> Range<Int> {
        let starts = entries.map { clock.minutesFromMidnight($0.startsAt) / 60 }
        let ends = entries.map { (clock.minutesFromMidnight($0.endsAt) + 59) / 60 }
        let lower = min(starts.min() ?? 9, 9)
        let upper = max(ends.max() ?? 19, 19)
        return lower..<max(upper, lower + 1)
    }
}
