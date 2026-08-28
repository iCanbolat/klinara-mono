import SwiftUI

/// Prim ekranlarının girişi.
///
/// Üç ayrı soru, üç ayrı ekran: **kim ne kadar hak etti** (rapor), **hangi
/// işlemden doğdu** (tahakkuklar), **kural ne diyor** (kurallar). Dönem kapatma
/// raporun içinde değil dönem listesinde: kapatma geri alınamaz ve rapora
/// bakarken yanlışlıkla basılabilecek bir yerde durmamalı.
struct CommissionHomeView: View {

    let session: AppSession

    @State private var store: CommissionStore?

    private var canWrite: Bool { session.can(Permissions.financeCommissionWrite) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let store {
                    KlinaraCard(
                        title: "Prim",
                        footnote: "Tahakkuklar append-only'dir; iptaller ters kayıtla düşer, satır silinmez."
                    ) {
                        KlinaraNavigationRow(
                            label: "Personel bazlı rapor",
                            detail: "Ters kayıtlar düşülmüş net prim",
                            icon: "chart.bar"
                        ) {
                            CommissionReportView(session: session, store: store)
                        }
                        KlinaraDivider()
                        KlinaraNavigationRow(
                            label: "Tahakkuklar",
                            detail: "Hangi işlemden ne kadar prim doğdu",
                            icon: "list.bullet.rectangle.portrait"
                        ) {
                            CommissionAccrualListView(session: session, store: store)
                        }
                        KlinaraDivider()
                        KlinaraNavigationRow(
                            label: "Dönemler",
                            detail: canWrite ? "Dönem kapatma" : "Dönem durumu",
                            icon: "calendar.badge.clock"
                        ) {
                            CommissionPeriodListView(session: session, store: store)
                        }
                        KlinaraDivider()
                        KlinaraNavigationRow(
                            label: "Prim kuralları",
                            detail: "Kapsam, matrah, tetikleyici ve öncelik",
                            icon: "slider.horizontal.3"
                        ) {
                            CommissionRuleListView(session: session, store: store)
                        }
                    }

                    if !canWrite {
                        // "Yok" ile "değiştiremezsin" farkı: muhasebe primi
                        // görür ama kuralına dokunamaz ve bunu bilmeli.
                        Text("Prim kurallarını görüntüleyebilir, değiştiremezsiniz.")
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .padding(.horizontal, KlinaraMetrics.xs)
                    }

                    scopeNote
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("Prim")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard store == nil else { return }
            let created = CommissionStore(service: session.services.commissions)
            store = created
            await created.loadPeriods()
        }
    }

    /// Sunucudaki devreden madde ekranda da yazılı: `package` ve `product`
    /// kapsamlı kurallar kaydedilebiliyor ama henüz prim üretmiyor. Bunu
    /// söylememek, kural tanımlayıp primi bekleyen bir kullanıcı demekti.
    private var scopeNote: some View {
        Text("Prim şu an yalnız randevu hizmetlerinden doğuyor; paket ve ürün satış primi henüz tahakkuk etmiyor.")
            .klinaraText(.bodyM)
            .font(.footnote)
            .foregroundStyle(KlinaraColor.charcoalMuted)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, KlinaraMetrics.xs)
    }
}
