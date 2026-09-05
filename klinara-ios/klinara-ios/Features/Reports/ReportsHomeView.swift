import SwiftUI

/// Batch 10.1 raporlarının girişi.
///
/// Kartlar İZNE GÖRE süzülüyor ve süzme "en az biri" mantığında: ciroyu
/// `report.revenue:read`, doluluk ve gelmeme raporlarını `appointment:read.all`
/// açıyor. Muhasebede takvim izni, resepsiyonda ciro izni yok — ikisi de bu
/// ekranda farklı kart kümesi görüyor.
///
/// Göremediği kart RENDER EDİLMİYOR, devre dışı gösterilmiyor: kullanıcıya
/// tıklayamayacağı bir satır sunmak, hiç göstermemekten kötü.
struct ReportsHomeView: View {

    let session: AppSession

    @State private var store: ReportsStore?

    private var canSeeRevenue: Bool { session.can(Permissions.reportRevenueRead) }
    private var canSeeOwnPerformance: Bool { session.can(Permissions.reportPerformanceReadOwn) }
    private var canSeeCalendar: Bool { session.can(Permissions.appointmentReadAll) }

    private var canSeeOccupancy: Bool { canSeeCalendar || canSeeOwnPerformance }
    private var canSeePerformance: Bool { canSeeRevenue || canSeeOwnPerformance }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let store {
                    KlinaraCard(
                        title: "Raporlar",
                        footnote: "Dönem aralığı yarı açıktır: bitiş günü dahil değildir."
                    ) {
                        if canSeeOccupancy {
                            KlinaraNavigationRow(
                                label: "Doluluk",
                                detail: "Müsait dakikaların ne kadarı dolu",
                                icon: "gauge.with.needle"
                            ) {
                                OccupancyReportView(session: session, store: store)
                            }
                            KlinaraDivider()
                        }
                        if canSeeRevenue {
                            KlinaraNavigationRow(
                                label: "Ciro",
                                detail: "Tahakkuk eden ve tahsil edilen, ayrı ayrı",
                                icon: "banknote"
                            ) {
                                RevenueReportView(session: session, store: store)
                            }
                            KlinaraDivider()
                        }
                        if canSeePerformance {
                            KlinaraNavigationRow(
                                label: "Personel performansı",
                                detail: "İşlem, ciro, prim ve doluluk",
                                icon: "person.2"
                            ) {
                                StaffPerformanceReportView(session: session, store: store)
                            }
                            KlinaraDivider()
                        }
                        if canSeeCalendar {
                            KlinaraNavigationRow(
                                label: "Gelmeme ve iptal",
                                detail: "Randevu başına gelmeme ve iptal oranı",
                                icon: "calendar.badge.exclamationmark"
                            ) {
                                NoShowReportView(session: session, store: store)
                            }
                            KlinaraDivider()
                            KlinaraNavigationRow(
                                label: "Kazanım ve geri dönüş",
                                detail: "Yeni müşteri, geri gelen ve geliş kaynağı",
                                icon: "person.crop.circle.badge.plus"
                            ) {
                                RetentionReportView(session: session, store: store)
                            }
                        }
                    }

                    if !canSeeRevenue {
                        // "Yok" ile "göremiyorsun" farkı: ciro raporu burada
                        // eksik değil, kapalı.
                        Text("Ciro raporu bu rolde görüntülenemez.")
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
            store = ReportsStore(
                service: session.services.reports,
                clock: session.clock,
                branchId: session.selectedBranchId
            )
        }
    }
}
