import SwiftUI

/// Gün ızgarasının ölçüleri. Blok yerleşimi ve saat cetveli **aynı** sayıları
/// kullanmak zorunda; iki ayrı yerde tanımlanmaları, bir gün birinin 60'a
/// diğerinin 64'e kayması demekti.
enum CalendarGridMetrics {
    /// Bir saatin piksel yüksekliği.
    static let hourHeight: CGFloat = 64
    /// Saat etiketleri sütununun genişliği.
    static let rulerWidth: CGFloat = 52
    /// 15 dakikalık bir randevu bile okunabilir kalsın.
    static let minimumBlockHeight: CGFloat = 28

    static func offset(minutesFromMidnight minutes: Int) -> CGFloat {
        CGFloat(minutes) / 60 * hourHeight
    }

    static func height(minutes: Int) -> CGFloat {
        max(minimumBlockHeight, CGFloat(minutes) / 60 * hourHeight)
    }
}

/// Izgaranın sol saat cetveli ve yatay çizgileri.
struct TimeAxisRuler: View {

    /// Gösterilecek ilk ve son saat (dahil değil): `9..<20`.
    let hours: Range<Int>

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(hours, id: \.self) { hour in
                HStack(alignment: .top, spacing: 0) {
                    Text(String(format: "%02d:00", hour))
                        .font(.system(size: 11, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .frame(width: CalendarGridMetrics.rulerWidth, alignment: .leading)
                        // Etiket çizginin üstüne değil, ortasına hizalanır.
                        .offset(y: -6)

                    Rectangle()
                        .fill(KlinaraColor.border)
                        .frame(height: KlinaraMetrics.borderWidth)
                }
                .frame(height: CalendarGridMetrics.hourHeight, alignment: .top)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Şu anki saati gösteren çizgi. Yalnız bugüne bakılırken çizilir.
struct NowIndicator: View {
    var body: some View {
        HStack(spacing: 0) {
            Circle()
                .fill(KlinaraColor.danger)
                .frame(width: 7, height: 7)
            Rectangle()
                .fill(KlinaraColor.danger)
                .frame(height: 1.5)
        }
        .accessibilityLabel("Şu an")
    }
}

/// Izgaradaki tek randevu bloğu.
///
/// Yükseklik süreden gelir; kısa randevularda metin taşmasın diye içerik
/// yüksekliğe göre kısalır. Renk hizmetin takvim rengidir — listede görülen
/// renkle ızgaradaki blok aynı olmalı, aksi hâlde renk bir işaret olmaktan çıkar.
struct AppointmentBlockView: View {

    let title: String
    let subtitle: String?
    let timeRange: String
    let colorHex: String?
    let status: String
    /// Sonlanmış randevu (iptal / gelmedi) soluk çizilir ve üstü çizilir.
    var isTerminal = false
    let height: CGFloat

    private var accent: Color {
        colorHex.flatMap { Color(hex: $0) } ?? KlinaraColor.sage
    }

    private var isCompact: Bool { height < 46 }

    var body: some View {
        HStack(spacing: KlinaraMetrics.sm) {
            RoundedRectangle(cornerRadius: 2)
                .fill(accent)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .klinaraText(.bodyEmphasis)
                    .strikethrough(isTerminal)
                    .lineLimit(1)

                if !isCompact {
                    Text(timeRange + (subtitle.map { " · \($0)" } ?? ""))
                        .font(.system(size: 11))
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, KlinaraMetrics.sm)
        .padding(.vertical, isCompact ? 4 : KlinaraMetrics.sm)
        .frame(height: height, alignment: .top)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(accent.opacity(isTerminal ? 0.05 : 0.14))
        .overlay(
            RoundedRectangle(cornerRadius: KlinaraMetrics.controlRadius - 4)
                .stroke(accent.opacity(isTerminal ? 0.2 : 0.4), lineWidth: KlinaraMetrics.borderWidth)
        )
        .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius - 4))
        .opacity(isTerminal ? 0.6 : 1)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(timeRange), \(status)")
    }
}

/// Yoğunluk ısı haritasının ortak renk ölçeği.
///
/// Tek yerde durması şart: gün şeridi ile hafta ızgarasının hücreleri aynı
/// sayıyı farklı koyulukta gösterseydi, ikisi arasında geçen kullanıcı için
/// renk bir ölçü olmaktan çıkardı.
enum DensityScale {

    /// Dolu bir saatin en açık tonu bile boş bir saatten ayırt edilebilmeli;
    /// taban 0.25'ten başlıyor, 0'dan değil.
    static func color(count: Int, peak: Int) -> Color {
        guard count > 0 else { return KlinaraColor.border.opacity(0.35) }
        let ratio = Double(count) / Double(max(peak, 1))
        return KlinaraColor.sageDeep.opacity(0.25 + 0.75 * min(ratio, 1))
    }
}

/// Yoğunluk şeridi — `density[]` verisinden saat başına doluluk.
///
/// Isı haritasının en dar hâli: bir gün, saat başına bir kare.
struct DensityStrip: View {

    /// Saat → randevu sayısı.
    let counts: [Int: Int]
    let hours: Range<Int>
    /// Ortak tepe değeri. `nil` ise şerit kendi içinde ölçeklenir; birden çok
    /// gün yan yana gösterilirken ortak bir tepe **verilmeli**, aksi hâlde
    /// sakin bir gün ile dolu bir gün aynı koyulukta çıkar.
    var peak: Int?
    /// Erişilebilirlik etiketine giren gün adı; tek gün gösterilirken gereksiz.
    var dayName: String?

    private var resolvedPeak: Int { peak ?? max(counts.values.max() ?? 0, 1) }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(hours, id: \.self) { hour in
                let count = counts[hour] ?? 0
                RoundedRectangle(cornerRadius: 3)
                    .fill(DensityScale.color(count: count, peak: resolvedPeak))
                    .frame(height: 22)
                    .accessibilityLabel(label(hour: hour, count: count))
            }
        }
    }

    private func label(hour: Int, count: Int) -> String {
        let time = String(format: "%02d:00", hour)
        guard let dayName else { return "\(time), \(count) randevu" }
        return "\(dayName) \(time), \(count) randevu"
    }
}

/// Isı haritası lejantı — "az" ile "çok"un neye benzediğini söyler.
///
/// Renk ölçeği göreli: en koyu kare **o aralığın** en yoğun saati demek,
/// mutlak bir eşik değil. Lejant bunu tepe sayıyı yazarak açık ediyor.
struct DensityLegend: View {

    let peak: Int
    /// Isı şube geneli mi, süzülmüş mü. Sunucu yoğunluğu personel filtresine
    /// göre daraltmıyor ve bunu söylememek yanlış okumaya davet olurdu.
    var note: String?

    var body: some View {
        HStack(spacing: KlinaraMetrics.xs) {
            Text("az")
                .font(.system(size: 10))
                .foregroundStyle(KlinaraColor.charcoalMuted)

            HStack(spacing: 2) {
                ForEach(0..<4, id: \.self) { step in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(DensityScale.color(count: step + 1, peak: 4))
                        .frame(width: 12, height: 8)
                }
            }

            Text(peak > 0 ? "çok (\(peak))" : "çok")
                .font(.system(size: 10))
                .foregroundStyle(KlinaraColor.charcoalMuted)

            if let note {
                Text("· \(note)")
                    .font(.system(size: 10))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Yoğunluk ölçeği, en yoğun saatte \(peak) randevu"
                + (note.map { ". \($0)" } ?? "")
        )
    }
}

/// Hafta ızgarasındaki tek randevu bloğu.
///
/// ``AppointmentBlockView``den ayrı: yedi sütun ekrana sığdığında bir sütun
/// ~45pt kalıyor ve o genişlikte ad, saat ve durum yan yana **okunmuyor**.
/// Hafta görünümünün cevapladığı soru "bu hafta nerede boşluk var"; ayrıntı
/// bloğa dokununca açılan detayda. Yine de her blok tam bilgisini
/// erişilebilirlik etiketinde taşıyor — VoiceOver kullanıcısı için görsel
/// daralma bir bilgi kaybı olmamalı.
struct WeekBlockView: View {

    let title: String
    let timeRange: String
    let colorHex: String?
    let status: String
    var isTerminal = false
    let height: CGFloat

    private var accent: Color {
        colorHex.flatMap { Color(hex: $0) } ?? KlinaraColor.sage
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 4)
                .fill(accent.opacity(isTerminal ? 0.08 : 0.22))
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(accent.opacity(isTerminal ? 0.25 : 0.5), lineWidth: 1)
                )

            HStack(spacing: 2) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(accent)
                    .frame(width: 2)

                // 24pt'nin altında metin bir çizgiye dönüşüyor; boş bırakmak
                // yanlış okunan bir harften iyi.
                if height >= 24 {
                    Text(title)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(KlinaraColor.charcoal)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(2)
        }
        .frame(height: height, alignment: .top)
        .opacity(isTerminal ? 0.6 : 1)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(timeRange), \(status)")
    }
}

#Preview("Takvim ilkelleri") {
    VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
        AppointmentBlockView(
            title: "Ayşe Yılmaz",
            subtitle: "Tüm Vücut Lazer",
            timeRange: "09:30 – 10:30",
            colorHex: "#7F9A76",
            status: "Planlandı",
            height: CalendarGridMetrics.height(minutes: 60)
        )

        AppointmentBlockView(
            title: "Mehmet Demir",
            subtitle: "Bölgesel Lazer",
            timeRange: "11:00 – 11:30",
            colorHex: "#B08968",
            status: "İptal",
            isTerminal: true,
            height: CalendarGridMetrics.height(minutes: 30)
        )

        DensityStrip(counts: [9: 1, 10: 3, 11: 2, 14: 1], hours: 9..<19)

        DensityLegend(peak: 3, note: "şube geneli")

        WeekBlockView(
            title: "Ayşe Yılmaz",
            timeRange: "09:30 – 10:30",
            colorHex: "#7F9A76",
            status: "Planlandı",
            height: CalendarGridMetrics.height(minutes: 60)
        )
        .frame(width: 46)

        TimeAxisRuler(hours: 9..<12)
    }
    .padding(KlinaraMetrics.screenInset)
    .background(KlinaraColor.surface)
}
