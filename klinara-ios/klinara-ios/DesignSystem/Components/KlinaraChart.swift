import Charts
import SwiftUI

/// Grafik sarmalayıcısı — `import Charts` YALNIZ BU DOSYADA.
///
/// Kural bir üslup tercihi değil: grafik biçimini değiştirmek (ya da bir gün
/// Swift Charts'tan çıkmak) tek bir dosyayı değiştirmek olmalı. Ekranlar veri
/// ve biçimlendirici veriyor, çizim biçiminden habersizler.
///
/// ⚠️ GRAFİK İKİNCİL. Her rapor ekranında satırlar ayrıca `KlinaraRow` olarak
/// listeleniyor ve gerçeğin kaynağı o liste; grafik `accessibilityHidden`.
/// Bir grafiği VoiceOver'a anlamlı kılmaya çalışmak yerine aynı veriyi zaten
/// erişilebilir bir listede vermek hem daha dürüst hem daha az kod.
struct KlinaraChartPoint: Identifiable, Sendable {
    let id: String
    let label: String
    let value: Double

    init(id: String, label: String, value: Double) {
        self.id = id
        self.label = label
        self.value = value
    }
}

struct KlinaraChart: View {

    enum Kind {
        case bar
        case line
    }

    let kind: Kind
    let points: [KlinaraChartPoint]
    /// Eksende ve etikette değeri biçimlendirir.
    let format: (Double) -> String

    var height: CGFloat = 180

    var body: some View {
        if points.isEmpty {
            EmptyView()
        } else {
            Chart(points) { point in
                // Tek noktalı bir çizgi görünmez bir nokta çizer; o durumda
                // sütun daha dürüst.
                if kind == .line, points.count > 1 {
                    LineMark(
                        x: .value("Kırılım", point.label),
                        y: .value("Değer", point.value)
                    )
                    .foregroundStyle(KlinaraColor.sageDeep)
                    .interpolationMethod(.monotone)
                } else {
                    BarMark(
                        x: .value("Kırılım", point.label),
                        y: .value("Değer", point.value)
                    )
                    .foregroundStyle(KlinaraColor.sageDeep)
                    .cornerRadius(3)
                }
            }
            .chartYAxis {
                AxisMarks { value in
                    AxisGridLine()
                    AxisValueLabel {
                        if let number = value.as(Double.self) {
                            Text(format(number))
                                .klinaraText(.label)
                        }
                    }
                }
            }
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let label = value.as(String.self) {
                            Text(label)
                                .klinaraText(.label)
                                .lineLimit(1)
                        }
                    }
                }
            }
            .frame(height: height)
            .padding(KlinaraMetrics.md)
            .accessibilityHidden(true)
        }
    }
}

// MARK: - Yatay (yığın) çubuk

/// Yatay çubuk grafiğin bir satırı. Tek serili grafikte `segments` tek eleman.
struct KlinaraBarRow: Identifiable, Sendable {
    let id: String
    let label: String
    /// Seri başına değer, çizim sırasıyla.
    let segments: [KlinaraBarSegment]
}

struct KlinaraBarSegment: Identifiable, Sendable {
    let series: String
    let value: Double

    var id: String { series }
}

/// Seri adı ve rengi. Sıra, yığındaki ve lejanttaki sıradır.
struct KlinaraBarSeries: Sendable {
    let name: String
    let color: Color
}

/// Yatay, isteğe bağlı yığın çubuk grafik — web shadcn `BarChart layout="vertical"`
/// karşılığı (genel bakıştaki şube karşılaştırması).
///
/// Dikey ``KlinaraChart`` uzun şube adlarını kırpıyordu; yatayda ad eksende
/// tam okunuyor ve satır sayısı arttıkça grafik aşağı uzuyor. Y ekseni satır
/// KİMLİĞİYLE çiziliyor, etiket ondan okunuyor: aynı adlı iki şube tek çubukta
/// birleşmesin.
///
/// ⚠️ Aynı kural: grafik `accessibilityHidden`; çağıran aynı sayıları
/// erişilebilir satırlarda ayrıca veriyor.
struct KlinaraHorizontalBarChart: View {

    let rows: [KlinaraBarRow]
    let series: [KlinaraBarSeries]
    let format: (Double) -> String

    private var labels: [String: String] {
        Dictionary(rows.map { ($0.id, $0.label) }, uniquingKeysWith: { first, _ in first })
    }

    var body: some View {
        if rows.isEmpty {
            EmptyView()
        } else {
            Chart {
                ForEach(rows) { row in
                    ForEach(row.segments) { segment in
                        BarMark(
                            x: .value("Değer", segment.value),
                            y: .value("Kırılım", row.id)
                        )
                        .foregroundStyle(by: .value("Seri", segment.series))
                    }
                }
            }
            .chartForegroundStyleScale(
                domain: series.map(\.name),
                range: series.map(\.color)
            )
            .chartLegend(series.count > 1 ? .visible : .hidden)
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 3)) { value in
                    AxisGridLine()
                    AxisValueLabel {
                        if let number = value.as(Double.self) {
                            Text(format(number))
                                .klinaraText(.label)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let id = value.as(String.self) {
                            Text(labels[id] ?? id)
                                .klinaraText(.label)
                                .lineLimit(1)
                        }
                    }
                }
            }
            .frame(height: CGFloat(rows.count) * 40 + (series.count > 1 ? 72 : 40))
            .padding(KlinaraMetrics.md)
            .accessibilityHidden(true)
        }
    }
}
