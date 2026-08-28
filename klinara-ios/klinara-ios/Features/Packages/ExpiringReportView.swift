import SwiftUI

/// Yaklaşan süre dolumu — seçilen dönemde yanacak paketler.
///
/// Aralık yarı açıktır: dönem başlığı `[from, to)` sözleşmesini gösteriyor.
/// Parasal alan yalnız `report.revenue:read` izniyle dolu gelir; izin yoksa
/// "—" yazılır, sıfır değil — taşınmayan bir borç iddiası olurdu.
struct ExpiringReportView: View {

    let session: AppSession
    let store: PackageReportsStore

    private var clock: BranchClock { session.clock }
    private var canSeeRevenue: Bool { session.can(Permissions.reportRevenueRead) }

    var body: some View {
        KlinaraScreen(
            state: store.expiring,
            emptyCheck: { $0.data.isEmpty },
            emptyTitle: "Bu dönemde süre dolumu yok",
            emptyMessage: "Seçilen aralıkta süresi dolacak paket bulunmuyor.",
            emptyIcon: "hourglass",
            onRetry: { await store.loadExpiring() }
        ) { report in
            ReportPeriodBar(label: store.periodLabel) { shift in
                store.shiftPeriod(by: shift)
                Task { await store.loadExpiring() }
            }

            KlinaraCard(title: "Paketler", footnote: "Dönem sonu tarihi aralığa dâhil değildir.") {
                ForEach(Array(report.data.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { KlinaraDivider() }
                    self.row(row)
                }
            }
        }
        .navigationTitle("Süre dolumu")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadExpiring() }
        .refreshable { await store.loadExpiring() }
    }

    private func row(_ item: ExpiringRow) -> some View {
        NavigationLink {
            CustomerDetailView(session: session, customerId: item.customerId)
        } label: {
            VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
                HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
                    Text(item.customerName)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text(amountLabel(item))
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .monospacedDigit()
                        .fixedSize()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }

                Text("\(item.packageName) · \(item.remainingSessions) seans · \(clock.formatDate(item.expiresAt))")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(KlinaraMetrics.md)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func amountLabel(_ item: ExpiringRow) -> String {
        guard canSeeRevenue, let minor = item.outstandingMinor else { return "—" }
        return Money.format(minor: minor)
    }
}
