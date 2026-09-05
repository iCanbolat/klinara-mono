import SwiftUI

// 10.1'de `Features/Packages/PackageReportsHomeView.swift`in dibinden BURAYA
// TAŞINDI. Faz 5'te iki ekran kullanıyordu; Faz 10 ile beş ekran daha katıldı
// ve üçüncü kullanıcı kopyalamayı hak etmiyordu. Davranış değişmedi.

/// Rapor ekranlarının ortak dönem başlığı.
///
/// Aralık **yarı açıktır** ve bu ekranda görünür kılınıyor: ay raporunda son
/// günün eksik sanılması, sunucudaki `[from, to)` sözleşmesinin en sık yol
/// açtığı yanlış anlama.
struct ReportPeriodBar: View {

    let label: String
    let onShift: (Int) -> Void

    var body: some View {
        KlinaraCard {
            HStack(spacing: KlinaraMetrics.md) {
                Button {
                    onShift(-1)
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 15, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(KlinaraColor.sageDeep)
                .accessibilityLabel("Önceki dönem")

                Text(label)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity)

                Button {
                    onShift(1)
                } label: {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 15, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(KlinaraColor.sageDeep)
                .accessibilityLabel("Sonraki dönem")
            }
            .padding(KlinaraMetrics.md)
        }
    }
}
