import SwiftUI

/// Müşteri paketi detayı: kalemler, defter ve işlemler.
///
/// Ekran **id ile** açılır, model ile değil: iade ya da düzeltme sonrası
/// store'daki güncel kayda bakmalı, açılışta kopyalanmış bayat bir modele değil.
struct CustomerPackageDetailView: View {

    let session: AppSession
    let store: CustomerPackagesStore
    let packageId: String

    @State private var error: APIError?
    @State private var operation: Operation?

    private enum Operation: String, Identifiable {
        case adjust, refund, transfer
        var id: String { rawValue }
    }

    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.packageWrite) }
    private var canRefund: Bool { session.can(Permissions.packageRefund) }
    private var canTransfer: Bool { session.can(Permissions.packageTransfer) }

    var body: some View {
        ZStack {
            KlinaraColor.surface.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped {
                        ErrorBanner(error: error)
                    }

                    if let pkg = store.package(id: packageId) {
                        summaryCard(pkg)
                        itemsCard(pkg)
                        if canWrite || canRefund || canTransfer {
                            actionsCard(pkg)
                        }
                        PackageLedgerView(session: session, store: store, packageId: packageId)
                    } else {
                        ProgressView()
                            .tint(KlinaraColor.sage)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, KlinaraMetrics.xl)
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
        }
        .navigationTitle("Paket")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: packageId) {
            // Liste ucundan gelen `version` bayat olabilir; `If-Match` bayat
            // başlarsa ilk düzeltme denemesi boşuna 409 alır.
            await store.refresh(packageId: packageId)
            await store.loadLedger(packageId: packageId)
        }
        .overlay {
            if store.isSaving { AuthLoadingOverlay(message: "Kaydediliyor…") }
        }
        .sheet(item: $operation) { operation in
            if let pkg = store.package(id: packageId) {
                switch operation {
                case .adjust:
                    PackageAdjustSheet(session: session, store: store, package: pkg)
                case .refund:
                    PackageRefundSheet(session: session, store: store, package: pkg)
                case .transfer:
                    PackageTransferSheet(session: session, store: store, package: pkg)
                }
            }
        }
    }

    // MARK: Kartlar

    private func summaryCard(_ pkg: CustomerPackage) -> some View {
        KlinaraCard(title: pkg.name, footnote: refundFootnote(pkg)) {
            KlinaraRow(
                label: "Kalan hak",
                value: "\(pkg.remainingSessions)/\(pkg.totalSessions)",
                detail: "Defterden türetilir"
            )
            KlinaraDivider()
            KlinaraRow(label: "Durum") {
                KlinaraBadge(text: pkg.status.turkishName, tone: pkg.status.badgeTone)
            }
            KlinaraDivider()
            KlinaraRow(label: "Satış tarihi", value: clock.formatDate(pkg.soldAt))
            KlinaraDivider()
            KlinaraRow(
                label: "Geçerlilik",
                value: pkg.expiresAt.map { clock.formatDate($0) } ?? "Süresiz",
                detail: pkg.isExpired() ? "Süre doldu" : nil
            )
            KlinaraDivider()
            KlinaraRow(
                label: "Satış tutarı",
                value: Money.format(minor: pkg.totalPriceMinor, currency: pkg.currency)
            )
            KlinaraDivider()
            KlinaraRow(
                label: "Kalan hakkın karşılığı",
                value: Money.format(minor: pkg.outstandingMinor, currency: pkg.currency),
                detail: "Satış anındaki tahsisten hesaplanır"
            )
            if let note = pkg.note, !note.isEmpty {
                KlinaraDivider()
                KlinaraRow(label: "Not", detail: note)
            }
            if pkg.transferredFromPackageId != nil {
                KlinaraDivider()
                KlinaraRow(label: "Kaynak", detail: "Bu paket bir devirle oluştu")
            }
        }
    }

    /// İade edilmişse tutar ve **borcun kapanmadığı** görünmeli: kasa hareketi
    /// Faz 6.2'de bağlanacak, o zamana kadar `pending` bir yükümlülük.
    private func refundFootnote(_ pkg: CustomerPackage) -> String? {
        guard pkg.refundedSessions > 0 else { return nil }
        var text = "\(pkg.refundedSessions) seans iade edildi · "
            + Money.format(minor: pkg.refundAmountMinor, currency: pkg.currency)
        if pkg.refundSettlementStatus == "pending" {
            text += " · Kasa hareketi henüz oluşturulmadı (Faz 6)."
        }
        return text
    }

    private func itemsCard(_ pkg: CustomerPackage) -> some View {
        KlinaraCard(
            title: "Kalemler",
            footnote: "Kalan hak KALEM bazındadır: bir kalemin hakkı başka bir hizmet için kullanılamaz."
        ) {
            ForEach(Array(pkg.items.sorted { $0.sortOrder < $1.sortOrder }.enumerated()), id: \.element.id) { index, item in
                if index > 0 { KlinaraDivider() }
                itemRow(item, currency: pkg.currency)
            }
        }
    }

    private func itemRow(_ item: CustomerPackageItem, currency: String) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
                Text(item.serviceName)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text("\(item.remainingSessions)/\(item.quantityTotal)")
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .monospacedDigit()
                    .fixedSize()
            }

            ProgressView(value: item.usedFraction)
                .tint(KlinaraColor.sage)

            Text("Kullanılan \(item.usedSessions) seans · Kalan karşılık \(Money.format(minor: item.outstandingMinor, currency: currency))")
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(KlinaraMetrics.md)
    }

    private func actionsCard(_ pkg: CustomerPackage) -> some View {
        KlinaraCard(title: "İşlemler", footnote: actionsFootnote(pkg)) {
            VStack(spacing: KlinaraMetrics.sm) {
                if canWrite {
                    KlinaraButton(
                        title: "Kalan hakkı düzelt",
                        kind: .secondary,
                        icon: "slider.horizontal.3",
                        isEnabled: pkg.status.isOpen
                    ) { operation = .adjust }
                }
                if canRefund {
                    KlinaraButton(
                        title: "İade et",
                        kind: .secondary,
                        icon: "arrow.uturn.backward",
                        isEnabled: pkg.status.isOpen && pkg.remainingSessions > 0
                    ) { operation = .refund }
                }
                if canTransfer {
                    KlinaraButton(
                        title: "Devret",
                        kind: .secondary,
                        icon: "arrow.left.arrow.right",
                        isEnabled: pkg.status.isOpen && pkg.remainingSessions > 0
                            && pkg.isTransferable
                    ) { operation = .transfer }
                }
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private func actionsFootnote(_ pkg: CustomerPackage) -> String? {
        if !pkg.isTransferable, canTransfer { return "Bu paket devredilemez olarak satıldı." }
        if !pkg.status.isOpen { return "Kapanmış pakette işlem yapılamaz." }
        return nil
    }
}
