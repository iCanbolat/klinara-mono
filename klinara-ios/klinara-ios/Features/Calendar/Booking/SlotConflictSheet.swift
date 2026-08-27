import SwiftUI

/// `409 SLOT_CONFLICT` yanıtının okunabilir hâli.
///
/// Sunucu hangi kaynağın hangi aralıkta dolu olduğunu **ve** en fazla üç
/// alternatif saati gövdede söylüyor. Bunu genel bir "saat dolu" mesajına
/// indirmek, kullanıcıyı slot listesine geri gönderip aynı tahmini yeniden
/// yaptırmak olurdu.
///
/// İki alanın tarih biçimi farklı: `conflicts` UTC ve **buffer dahil**,
/// `suggestions` şube offset'li ve görünen aralık. ``BranchClock`` ikisini de
/// şube saatinde gösterir; ayrımı kullanıcı değil kod taşır.
struct SlotConflictSheet: View {

    let clock: BranchClock
    let error: APIError
    let staffName: (String) -> String
    let onPick: (SlotSuggestion) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    ErrorBanner(error: error)

                    if !error.slotConflicts.isEmpty {
                        KlinaraCard(
                            title: "Dolu olan",
                            footnote: "Gösterilen aralık hazırlık ve temizlik payını da içerir; "
                                + "randevunun görünen saati daha kısadır."
                        ) {
                            ForEach(Array(error.slotConflicts.enumerated()), id: \.element.id) { index, conflict in
                                if index > 0 { KlinaraDivider() }
                                KlinaraRow(
                                    label: staffName(conflict.resourceId),
                                    value: clock.formatRange(from: conflict.from, to: conflict.to)
                                )
                            }
                        }
                    }

                    if error.slotSuggestions.isEmpty {
                        KlinaraCard {
                            KlinaraRow(
                                label: "Alternatif bulunamadı",
                                detail: "Başka bir gün veya personel deneyin."
                            )
                        }
                    } else {
                        KlinaraCard(title: "Önerilen saatler") {
                            ForEach(Array(error.slotSuggestions.enumerated()), id: \.element.id) { index, suggestion in
                                if index > 0 { KlinaraDivider() }
                                Button {
                                    onPick(suggestion)
                                    dismiss()
                                } label: {
                                    KlinaraRow(
                                        label: clock.formatRange(
                                            from: suggestion.startsAt,
                                            to: suggestion.endsAt
                                        ),
                                        detail: suggestion.staffProfileIds
                                            .map(staffName)
                                            .joined(separator: ", ")
                                    ) {
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(KlinaraColor.charcoalMuted)
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("Saat dolu")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Kapat") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
        }
        .tint(KlinaraColor.sage)
        .presentationDetents([.medium, .large])
    }
}
