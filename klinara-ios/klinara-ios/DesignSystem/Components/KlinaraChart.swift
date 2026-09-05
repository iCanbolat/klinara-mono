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
