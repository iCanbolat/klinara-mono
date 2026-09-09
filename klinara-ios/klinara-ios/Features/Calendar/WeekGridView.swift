import SwiftUI

/// Haftanın zaman ızgarası — yedi gün sütunu, ortak saat ekseni.
///
/// Gün ızgarası "bugün nerede boşluk var" sorusunu cevaplıyor; hafta ızgarası
/// asıl sorulanı: **"bu hafta nereye sığar"**. Randevu önerirken kullanıcı
/// yedi günü tek tek gezmek zorunda kalıyordu ve iki gün arasındaki doluluk
/// farkı ancak akılda tutularak karşılaştırılabiliyordu.
///
/// Yedi sütun ekrana **sığdırılıyor**, yatay kaydırma yok: gün başlıkları ve
/// ısı haritası her an görünür kalıyor, kaydırma yalnız dikey. Karşılığında
/// sütun ~45pt ve bloklar ``WeekBlockView`` ile daralıyor; ayrıntı bloğa
/// dokununca açılıyor.
///
/// Sunucudan gelen `density[]` ızgaranın **arkasına** boyanıyor. Ayrı bir
/// şerit, ısıyı ızgaranın hizasından koparırdı: "salı 14:00 yoğun" bilgisi
/// ancak o hücrenin kendisinde işe yarıyor.
struct WeekGridView: View {

    let clock: BranchClock
    /// Haftanın günleri, ``BranchClock/weekDays(of:)`` sırasında.
    let days: [Date]
    let selectedDay: Date
    let entries: [CalendarEntry]
    /// `yerelGün → saat → randevu sayısı`.
    let density: [String: [Int: Int]]
    /// Haftanın en yoğun saati; sütunların ortak ölçeği.
    let densityPeak: Int
    /// Isının süzülmediğini söyleyen not (personel filtresi açıkken).
    var densityNote: String?
    let staffColor: (String) -> String?
    let onSelect: (CalendarEntry) -> Void
    let onSelectDay: (Date) -> Void

    private var hours: Range<Int> {
        CalendarBlockLayout.hours(for: entries, clock: clock)
    }

    private var gridHeight: CGFloat {
        CGFloat(hours.count) * CalendarGridMetrics.hourHeight
    }

    var body: some View {
        VStack(spacing: KlinaraMetrics.xs) {
            dayHeader

            // Lejant ızgaranın ÜSTÜNDE: altta bıraktığımızda yüzen sekme
            // çubuğunun arkasına düşüyor ve açıkladığı şeyi hiç açıklamıyordu.
            if densityPeak > 0 {
                DensityLegend(peak: densityPeak, note: densityNote)
            }

            ScrollView(.vertical) {
                grid
                    .frame(height: gridHeight, alignment: .top)
                    // İlk saat etiketi çizgisinin üstüne taşıyor; kaydırma
                    // alanının kenarında kırpılmasın.
                    .padding(.top, 6)
                    // Son saat, yüzen sekme çubuğunun altında kalmasın.
                    .padding(.bottom, KlinaraMetrics.xxl)
            }
        }
    }

    // MARK: Başlık

    private var dayHeader: some View {
        HStack(spacing: columnSpacing) {
            // Başlık satırı ile ızgara AYNI iskeleti kullanıyor: solda cetvel
            // genişliğinde bir sütun, sağda eşit yedi sütun. İki yerde iki
            // farklı hizalama, başlıkların sütunlarından kayması demekti.
            Color.clear.frame(width: rulerWidth, height: 1)

            ForEach(days, id: \.timeIntervalSince1970) { day in
                Button { onSelectDay(day) } label: {
                    dayLabel(day)
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func dayLabel(_ day: Date) -> some View {
        let isToday = clock.isToday(day)
        let isSelected = clock.isSameDay(day, selectedDay)

        return VStack(spacing: 1) {
            Text(clock.weekdayInitial(day))
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(KlinaraColor.charcoalMuted)
            Text(clock.dayNumber(day))
                .font(.system(size: 13, weight: isToday ? .bold : .medium))
                .monospacedDigit()
                .foregroundStyle(isToday ? KlinaraColor.sageDeep : KlinaraColor.charcoal)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
        .background(isSelected ? KlinaraColor.sageDeep.opacity(0.12) : .clear)
        .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius - 6))
        .contentShape(.rect)
        .accessibilityLabel(clock.formatDate(day))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    // MARK: Izgara

    /// Sütunlar arası boşluk kasten dar: 402pt'lik bir ekranda cetvelden
    /// sonra yedi güne kalan ~45pt'yi boşluğa harcamanın karşılığı yok.
    private let columnSpacing: CGFloat = 2

    /// Cetvel sütunu gün ızgarasınınkinden dar: burada yalnız etiket var,
    /// ``TimeAxisRuler``ın tam genişlikteki yatay çizgisi yok — çizgiler her
    /// sütunun kendi saat hücresinden geliyor ve hiza kurulum gereği doğru.
    private let rulerWidth: CGFloat = 44

    private var grid: some View {
        HStack(spacing: columnSpacing) {
            hourLabels
            ForEach(days, id: \.timeIntervalSince1970) { day in
                column(day)
            }
        }
    }

    private var hourLabels: some View {
        VStack(spacing: 0) {
            ForEach(hours, id: \.self) { hour in
                Text(String(format: "%02d:00", hour))
                    .font(.system(size: 10, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(
                        width: rulerWidth,
                        height: CalendarGridMetrics.hourHeight,
                        alignment: .topLeading
                    )
                    // Etiket saatin çizgisine hizalanır, hücrenin ortasına değil.
                    .offset(y: -5)
            }
        }
        .frame(width: rulerWidth)
        .accessibilityHidden(true)
    }

    private func column(_ day: Date) -> some View {
        let key = clock.localDateString(day)
        let dayEntries = entries.filter { clock.isSameDay($0.startsAt, day) }

        return ZStack(alignment: .topLeading) {
            heatColumn(counts: density[key] ?? [:], dayName: clock.formatDate(day))

            GeometryReader { proxy in
                ForEach(
                    CalendarBlockLayout.place(
                        entries: dayEntries,
                        clock: clock,
                        originMinutes: hours.lowerBound * 60,
                        width: proxy.size.width,
                        // Dar sütunda kenar boşluğu, bloğu okunmaz yapardı.
                        gutter: 0
                    )
                ) { placed in
                    Button { onSelect(placed.entry) } label: {
                        WeekBlockView(
                            title: placed.entry.customerName,
                            timeRange: clock.formatRange(
                                from: placed.entry.startsAt,
                                to: placed.entry.endsAt
                            ),
                            colorHex: placed.entry.services.first
                                .flatMap { staffColor($0.staffProfileId) },
                            status: placed.entry.status.turkishName,
                            isTerminal: placed.entry.status.isTerminal,
                            height: placed.height
                        )
                    }
                    .buttonStyle(.plain)
                    .frame(width: placed.width)
                    .offset(x: placed.x, y: placed.y)
                }
            }

            if clock.isToday(day), let offset = nowOffset {
                NowIndicator().offset(y: offset)
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// Sütunun arkasındaki saat hücreleri — ısı haritasının kendisi.
    ///
    /// Boş saat de çiziliyor: hücrelerin üst çizgisi ızgaranın yatay hatlarını
    /// veriyor ve onlar olmadan bir bloğun hangi saate düştüğü okunmuyor.
    private func heatColumn(counts: [Int: Int], dayName: String) -> some View {
        VStack(spacing: 0) {
            ForEach(hours, id: \.self) { hour in
                let count = counts[hour] ?? 0
                DensityScale.color(count: count, peak: densityPeak)
                    .opacity(0.55)
                    .frame(height: CalendarGridMetrics.hourHeight)
                    .overlay(alignment: .top) {
                        Rectangle()
                            .fill(KlinaraColor.border)
                            .frame(height: KlinaraMetrics.borderWidth)
                    }
                    .accessibilityLabel(
                        "\(dayName) \(String(format: "%02d:00", hour)), \(count) randevu"
                    )
            }
        }
    }

    private var nowOffset: CGFloat? {
        let minutes = clock.minutesFromMidnight(Date()) - hours.lowerBound * 60
        guard minutes >= 0, minutes <= hours.count * 60 else { return nil }
        return CalendarGridMetrics.offset(minutesFromMidnight: minutes)
    }
}
