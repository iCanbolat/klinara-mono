import SwiftUI

/// Prim dönemleri ve dönem kapatma.
///
/// **Kapatma geri alınamaz**: kapalı bir döneme tahakkuk yazılamaz ve
/// düzeltmeler cari döneme düşer. Bu yüzden kapatma bir onay sheet'inin
/// arkasında duruyor, listede tek dokunuşla erişilebilir değil.
///
/// Dönemler ilk tahakkukta **otomatik** açılıyor; oluşturma ucu yok. Ekran bu
/// yüzden "dönem ekle" sunmuyor — sunmak, çalışmayacak bir düğme göstermekti.
struct CommissionPeriodListView: View {

    let session: AppSession
    let store: CommissionStore

    @State private var closingPeriod: CommissionPeriod?

    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.financeCommissionWrite) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                switch store.periodsState {
                case .loading:
                    ProgressView()
                        .tint(KlinaraColor.sage)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, KlinaraMetrics.xl)

                case .failed(let error):
                    ErrorBanner(error: error, onRetry: { Task { await store.loadPeriods() } })

                case .loaded(let periods):
                    if periods.isEmpty {
                        EmptyStateView(
                            icon: "calendar.badge.clock",
                            title: "Dönem yok",
                            message: "İlk prim tahakkukuyla birlikte dönem otomatik açılır."
                        )
                    } else {
                        KlinaraCard(
                            title: "Dönemler",
                            footnote: "Dönemler ilk tahakkukta otomatik açılır. Kapatma geri alınamaz."
                        ) {
                            ForEach(Array(periods.enumerated()), id: \.element.id) { index, period in
                                if index > 0 { KlinaraDivider() }
                                row(period)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("Prim dönemleri")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadPeriods() }
        .sheet(item: $closingPeriod) { period in
            ClosePeriodSheet(store: store, period: period)
        }
    }

    private func row(_ period: CommissionPeriod) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
                Text(period.rangeLabel)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .leading)

                KlinaraBadge(text: period.status.turkishName, tone: period.status.badgeTone)
            }

            if let closedAt = period.closedAt {
                Text("Kapatıldı: \(clock.formatDateTime(closedAt))")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if canWrite, !period.isClosed {
                Button("Dönemi kapat") {
                    closingPeriod = period
                }
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.sageDeep)
            }
        }
        .padding(KlinaraMetrics.md)
    }
}

/// Dönem kapatma onayı. Tek düğmeli bir sheet, çünkü sorulacak bir şey yok —
/// söylenecek bir şey var: bu işlem geri alınamaz.
private struct ClosePeriodSheet: View {

    let store: CommissionStore
    let period: CommissionPeriod

    @Environment(\.dismiss) private var dismiss

    @State private var error: APIError?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error {
                        ErrorBanner(error: error)
                    }

                    KlinaraCard(
                        title: "Dönemi kapat",
                        footnote: "Kapalı döneme tahakkuk yazılamaz. Sonradan gelen düzeltmeler cari döneme düşer."
                    ) {
                        KlinaraRow(label: "Dönem", value: period.rangeLabel, isMonospaced: true)
                        KlinaraDivider()
                        KlinaraRow(label: "Durum", value: period.status.turkishName)
                    }

                    KlinaraButton(
                        title: "Dönemi kapat",
                        kind: .primary,
                        icon: "lock",
                        isLoading: store.isSaving,
                        isEnabled: !store.isSaving
                    ) {
                        Task { await close() }
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("Dönem kapat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
        }
        .tint(KlinaraColor.sage)
    }

    private func close() async {
        error = nil
        do {
            _ = try await store.closePeriod(id: period.id, version: period.version)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
