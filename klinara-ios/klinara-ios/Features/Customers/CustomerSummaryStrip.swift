import SwiftUI

/// Müşteriler listesinin üstündeki kompakt özet: tek kart, dört sütun.
///
/// Dashboard'daki büyük ``KlinaraStatStrip`` burada BİLEREK kullanılmıyor —
/// listenin asıl içerik olduğu bir ekranda dört büyük kart ilk ekranı
/// yutardı. `summary == nil` iken sayılar yer tutucuyla çizilir; kart boyu
/// yükleme bitince değişmez.
struct CustomerSummaryStrip: View {

    let summary: CustomerSummary?

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                if index > 0 {
                    Rectangle()
                        .fill(KlinaraColor.border)
                        .frame(width: KlinaraMetrics.borderWidth)
                        .padding(.vertical, KlinaraMetrics.xs)
                }
                cell(item)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, KlinaraMetrics.md)
        .background(KlinaraColor.surfaceRaised)
        .overlay(
            RoundedRectangle(cornerRadius: KlinaraMetrics.cardRadius)
                .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
        )
        .clipShape(.rect(cornerRadius: KlinaraMetrics.cardRadius))
    }

    private struct Item {
        let label: String
        let value: Int?
        var accent: Color = KlinaraColor.charcoal
    }

    private var items: [Item] {
        [
            Item(label: "Toplam", value: summary?.total),
            Item(label: "Yeni · 30g", value: summary?.newLast30Days, accent: KlinaraColor.sageDeep),
            Item(label: "Aktif · 90g", value: summary?.activeLast90Days),
            Item(
                label: "Geri kazan",
                value: summary?.lapsed,
                accent: (summary?.lapsed ?? 0) > 0 ? KlinaraColor.danger : KlinaraColor.charcoal
            ),
        ]
    }

    private func cell(_ item: Item) -> some View {
        VStack(spacing: 2) {
            Text(item.value.map(String.init) ?? "00")
                .klinaraText(.titleM)
                .monospacedDigit()
                .foregroundStyle(item.accent)
                .redacted(reason: item.value == nil ? .placeholder : [])
            Text(item.label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(item.label): \(item.value.map(String.init) ?? "yükleniyor")")
    }
}

#Preview("Müşteri özeti") {
    VStack(spacing: 12) {
        CustomerSummaryStrip(summary: CustomerSummary(total: 248, newLast30Days: 12, activeLast90Days: 131, lapsed: 37))
        CustomerSummaryStrip(summary: nil)
        KlinaraSearchField(text: .constant(""), placeholder: "Ad veya telefon")
    }
    .padding()
    .background(KlinaraColor.surface)
}
