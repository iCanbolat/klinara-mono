import SwiftUI

/// Tek sayılık özet kartının verisi. `value == nil` → "—" (izin var, sayı yok).
struct KlinaraStat: Identifiable {
    let label: String
    let value: String?
    var icon: String?
    var hint: String?

    var id: String { label }
}

/// Tek sayılık özet kartı — web `StatCard` karşılığı: üstte etiket + ikon,
/// ortada büyük değer, altta ipucu (geçen aya göre değişim gibi).
///
/// **Yükseklik içerikten BAĞIMSIZ.** Şeritteki kartlar hizalı durmalı; ipucu
/// olan kartla olmayan, ipucu bir satıra sığanla sığmayan farklı boyda
/// çıkıyordu. Satır bütçesi sabit: etiket 1, değer 1, ipucu HER ZAMAN 2 satır
/// yer tutar (`reservesSpace`). Sabit pt yükseklik yerine satır bütçesi: büyük
/// Dynamic Type boyunda kart kırpılmadan birlikte büyür.
///
/// VoiceOver kartı TEK öğe olarak okur: üç ayrı odak durağı bir sayıyı üç
/// parçaya bölerdi.
struct KlinaraStatCard: View {

    let stat: KlinaraStat
    var isLoading = false

    /// İpucu alanı: iki `footnote` satırı. `reservesSpace` tek başına yetmedi —
    /// markanın satır aralığı yalnız GERÇEKTEN sarılan metinde ekleniyor ve iki
    /// satırlık ipucu kartı komşusundan 3pt uzun yapıyordu. Yükseklik Dynamic
    /// Type ile birlikte ölçekleniyor.
    @ScaledMetric(relativeTo: .footnote) private var hintHeight: CGFloat = 48

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            // İkon satır yüksekliğine KATILMIYOR (overlay): SF Symbol'lerin
            // yüksekliği sembolden sembole değişiyor ve rozetli bir ikon kartı
            // komşusundan uzun yapıyordu.
            Text(stat.label.uppercased(with: Locale(identifier: "tr_TR")))
                .klinaraText(.label)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .padding(.trailing, stat.icon == nil ? 0 : 22)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .trailing) {
                    if let icon = stat.icon {
                        Image(systemName: icon)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(KlinaraColor.sageDeep)
                            .frame(width: 18)
                    }
                }

            // Yer tutucu değerin KENDİ satır yüksekliğini kullanır: yükleme
            // bitince kart boyu değişmez.
            Text(stat.value ?? "—")
                .klinaraText(.titleM)
                .monospacedDigit()
                .foregroundStyle(KlinaraColor.charcoal)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .opacity(isLoading ? 0 : 1)
                .overlay(alignment: .leading) {
                    if isLoading {
                        RoundedRectangle(cornerRadius: KlinaraMetrics.xs)
                            .fill(KlinaraColor.border.opacity(0.5))
                            .frame(width: 96)
                    }
                }

            Text(stat.hint ?? "")
                .klinaraText(.bodyM)
                .font(.footnote)
                .lineSpacing(0)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .lineLimit(2)
                .frame(maxWidth: .infinity, minHeight: hintHeight, maxHeight: hintHeight, alignment: .topLeading)
        }
        .padding(KlinaraMetrics.md)
        // Izgara satırının yüksekliğini doldur: bir etiket beklenmedik şekilde
        // yükselirse komşu kart da hizalı kalır.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(KlinaraColor.surfaceRaised)
        .overlay(
            RoundedRectangle(cornerRadius: KlinaraMetrics.cardRadius)
                .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
        )
        .clipShape(.rect(cornerRadius: KlinaraMetrics.cardRadius))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            [stat.label, isLoading ? "Yükleniyor" : (stat.value ?? "—"), stat.hint]
                .compactMap { $0 }
                .joined(separator: ", ")
        )
    }
}

/// Özet kartı şeridi — iki sütunlu ızgara. Telefon genişliğinde dört kart yan
/// yana sığmaz; web de dar ekranda iki sütuna iner. Kartlar satır bütçesiyle
/// eşit boyda; tek kalan kart satırın yarısında durur.
struct KlinaraStatStrip: View {

    let stats: [KlinaraStat]
    var isLoading = false

    var body: some View {
        Grid(alignment: .topLeading, horizontalSpacing: KlinaraMetrics.sm, verticalSpacing: KlinaraMetrics.sm) {
            ForEach(Array(stride(from: 0, to: stats.count, by: 2)), id: \.self) { start in
                GridRow {
                    KlinaraStatCard(stat: stats[start], isLoading: isLoading)
                    if start + 1 < stats.count {
                        KlinaraStatCard(stat: stats[start + 1], isLoading: isLoading)
                    } else {
                        Color.clear
                    }
                }
            }
        }
    }
}

#Preview("Özet şeridi") {
    KlinaraStatStrip(stats: [
        KlinaraStat(label: "Bugünkü randevu", value: "12", icon: "calendar", hint: "8 aktif · 4 tamamlandı"),
        KlinaraStat(label: "Bu ay ciro", value: "182.500,00 ₺", icon: "banknote", hint: "Geçen aya göre +8%"),
        KlinaraStat(label: "Bu ay doluluk", value: nil, icon: "gauge.with.needle"),
    ])
    .padding()
    .background(KlinaraColor.surface)
}
