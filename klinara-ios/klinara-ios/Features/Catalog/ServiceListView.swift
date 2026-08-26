import SwiftUI

/// Hizmet listesi — kategoriye göre gruplu.
///
/// Fiyat ve süre **seçili şubenin** değerleriyle gösterilir: bir yöneticinin
/// Kadıköy şubesindeyken Nişantaşı fiyatını görmesi, override özelliğini
/// baştan işe yaramaz kılardı.
struct ServiceListView: View {

    let session: AppSession

    @State private var searchText = ""
    @State private var showsInactive = false
    @State private var editing: ServiceEditorView.Target?
    @State private var pendingDeactivation: ClinicService?

    private var store: CatalogStore { session.catalogStore }
    private var canWrite: Bool { session.can(Permissions.serviceWrite) }

    var body: some View {
        KlinaraScreen(
            state: store.state,
            emptyCheck: { $0.services.isEmpty },
            emptyTitle: "Henüz hizmet yok",
            emptyMessage: canWrite
                ? "İlk hizmeti ekleyerek başlayın. Süre ve hazırlık payı takvimde doğrudan kullanılır."
                : "Hizmet eklemek için yöneticinizle görüşün.",
            emptyIcon: "list.bullet.rectangle",
            onRetry: { await store.reload() }
        ) { catalog in
            let visible = filtered(catalog.services)

            if visible.isEmpty {
                Text("Aramanızla eşleşen hizmet yok.")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, KlinaraMetrics.xl)
            }

            ForEach(catalog.grouped(visible), id: \.category?.id) { group in
                KlinaraCard(title: group.category?.name ?? "Kategorisiz") {
                    ForEach(Array(group.services.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { KlinaraDivider() }
                        row(for: item)
                    }
                }
            }
        }
        .navigationTitle("Hizmetler")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Hizmet ara")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                // Fiyat ve süre seçili şubeye göre değiştiği için hangi şubede
                // olunduğu bu ekranda görünür olmalı.
                BranchMenu(session: session)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Toggle("Pasifleri göster", isOn: $showsInactive)
                    if canWrite {
                        Button {
                            editing = .create
                        } label: {
                            Label("Yeni hizmet", systemImage: "plus")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Seçenekler")
            }
        }
        .task { await store.load() }
        .refreshable { await store.reload() }
        .sheet(item: $editing) { target in
            ServiceEditorView(session: session, target: target)
        }
        .confirmationDialog(
            "Hizmet pasife alınsın mı?",
            isPresented: .init(
                get: { pendingDeactivation != nil },
                set: { if !$0 { pendingDeactivation = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Pasife al", role: .destructive) {
                guard let target = pendingDeactivation else { return }
                pendingDeactivation = nil
                Task { try? await store.deactivateService(id: target.id) }
            }
            Button("Vazgeç", role: .cancel) { pendingDeactivation = nil }
        } message: {
            // Kullanıcı "sil" beklerken "pasife al" olduğunu burada öğrenmeli:
            // geçmiş randevular ve satılmış paketler bu hizmete bağlı kalır.
            Text("Kayıt silinmez, pasife alınır. Geçmiş randevular ve paketler etkilenmez; hizmet yeni randevularda seçilemez.")
        }
    }

    // MARK: Satır

    private func row(for item: ClinicService) -> some View {
        let effective = item.effective(in: session.selectedBranchId)

        return Button {
            editing = .edit(item)
        } label: {
            HStack(alignment: .top, spacing: KlinaraMetrics.md) {
                ColorDot(hex: item.calendarColor, size: 12)
                    // Nokta adın hizasında dursun: satır iki-üç satıra
                    // büyüdüğünde dikey ortalama onu adın altına kaydırıyordu.
                    .padding(.top, 6)

                VStack(alignment: .leading, spacing: 4) {
                    Text(item.name)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    // Tek Text: ayrı Text'lerden kurulu bir HStack cümleyi
                    // ortasından kırıyordu ("takvimde 1 sa / 40 dk").
                    Text(durationSummary(effective))
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    HStack(spacing: KlinaraMetrics.xs) {
                        if effective.isOverridden {
                            KlinaraBadge(text: "Şubeye özel", tone: .neutral)
                        }
                        if !effective.isActive {
                            KlinaraBadge(text: "Pasif", tone: .muted)
                        }
                        if effective.isOnlineBookable {
                            KlinaraBadge(text: "Online", tone: .positive, icon: "globe")
                        }
                    }
                    .padding(.top, 2)
                }

                Text(Money.format(minor: effective.priceMinor))
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .monospacedDigit()
                    // Fiyat kırpılmasın; yer sıkışırsa süre satırı kırılsın.
                    .fixedSize()
                    .layoutPriority(1)
                    .padding(.top, 2)

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .padding(.top, 4)
            }
            .padding(KlinaraMetrics.md)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            if canWrite, item.isActive {
                Button(role: .destructive) {
                    pendingDeactivation = item
                } label: {
                    Label("Pasife al", systemImage: "archivebox")
                }
            }
        }
    }

    /// "1 sa 30 dk · takvimde 1 sa 55 dk". Takvimde işgal edilen süreyi
    /// gizlemek, "45 dakikalık hizmete neden 60 dakika ayrıldı?" sorusunu
    /// doğurur; hazırlık ve temizlik payı burada görünür olmalı.
    private func durationSummary(_ effective: ClinicService.Effective) -> String {
        let base = DurationFormat.format(minutes: effective.durationMinutes)
        guard effective.occupiedMinutes != effective.durationMinutes else { return base }
        return "\(base) · takvimde \(DurationFormat.format(minutes: effective.occupiedMinutes))"
    }

    // MARK: Filtre

    private func filtered(_ services: [ClinicService]) -> [ClinicService] {
        services
            .filter { showsInactive || $0.isActive }
            .filter { item in
                guard !searchText.isEmpty else { return true }
                return item.name.localizedCaseInsensitiveContains(searchText)
                    || item.slug.localizedCaseInsensitiveContains(searchText)
            }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}
