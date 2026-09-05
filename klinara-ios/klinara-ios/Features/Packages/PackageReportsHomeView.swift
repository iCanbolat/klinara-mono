import SwiftUI

/// Paket raporlarının girişi.
///
/// Üç rapor üç ayrı soruyu cevaplıyor: **ne kadar borçluyuz** (yükümlülük),
/// **ne zaman yanacak** (süre dolumu), **dönemde ne oldu** (kullanım). Tek bir
/// ekranda birleştirmek üçünü de okunmaz kılardı.
struct PackageReportsHomeView: View {

    let session: AppSession

    @State private var store: PackageReportsStore?

    private var canSeeRevenue: Bool { session.can(Permissions.reportRevenueRead) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let store {
                    KlinaraCard(
                        title: "Paket raporları",
                        footnote: "Tutarlar satış anındaki tahsisten hesaplanır, güncel katalog fiyatından değil."
                    ) {
                        if canSeeRevenue {
                            KlinaraNavigationRow(
                                label: "Taşınan yükümlülük",
                                detail: "Satılmış ama kullanılmamış seansların parasal karşılığı",
                                icon: "banknote"
                            ) {
                                OutstandingReportView(session: session, store: store)
                            }
                            KlinaraDivider()
                        }
                        KlinaraNavigationRow(
                            label: "Yaklaşan süre dolumu",
                            detail: "Seçilen dönemde süresi dolacak paketler",
                            icon: "hourglass"
                        ) {
                            ExpiringReportView(session: session, store: store)
                        }
                        KlinaraDivider()
                        KlinaraNavigationRow(
                            label: "Dönem kullanımı",
                            detail: "Satılan, tüketilen, iade ve süre dolumu",
                            icon: "chart.bar"
                        ) {
                            UsageReportView(session: session, store: store)
                        }
                    }

                    if !canSeeRevenue {
                        // "Yok" ile "göremiyorsun" farkı: yükümlülük raporu
                        // burada eksik değil, kapalı.
                        Text("Parasal raporlar bu rolde görüntülenemez.")
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .padding(.horizontal, KlinaraMetrics.xs)
                    }
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("Raporlar")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                BranchMenu(session: session)
            }
        }
        .task(id: session.branchGeneration) {
            store = PackageReportsStore(
                service: session.services.packages,
                clock: session.clock,
                branchId: session.selectedBranchId
            )
        }
    }
}
