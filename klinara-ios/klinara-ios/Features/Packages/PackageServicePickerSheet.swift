import SwiftUI

/// Paket tanımına kalem eklemek için hizmet seçici.
///
/// Genel ``KlinaraSearchablePicker`` burada yetersizdi: kaydırma alanı
/// olmadığı için içerik sheet'in ortasında yüzüyor, kart ekran kenarına
/// yapışıyor ve her seçimde sheet kapandığı için "10 lazer + 2 bakım"
/// gibi çok kalemli bir paket birkaç kez açıp kapatarak kuruluyordu.
///
/// Burada:
/// - Hizmetler katalogdaki gibi **kategoriye göre gruplu**, takvim rengi,
///   süre ve seçili şube fiyatıyla görünür.
/// - **Çoklu seçim**: işaretlenenler alttaki tek butonla birlikte eklenir.
/// - Pakette zaten olan hizmetler "Eklendi" olarak görünür ve seçilemez —
///   sunucu aynı hizmetin iki kez verilmesini zaten reddediyor.
struct PackageServicePickerSheet: View {

    let session: AppSession
    /// Formda zaten kalemi olan hizmetler.
    let existingServiceIds: Set<String>
    let onAdd: ([ClinicService]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    /// Seçim sırası korunur: kalemler forma işaretlendikleri sırayla eklenir.
    @State private var selectedIds: [String] = []

    private var store: CatalogStore { session.catalogStore }
    private var branchId: String? { session.selectedBranchId }

    private var activeServices: [ClinicService] {
        store.catalog.services
            .filter { $0.effective(in: branchId).isActive }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private var visibleServices: [ClinicService] {
        let term = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return activeServices }
        return activeServices.filter { service in
            SearchText.matches(service.name, term: term)
                || store.catalog.category(id: service.categoryId)
                    .map { SearchText.matches($0.name, term: term) } ?? false
        }
    }

    private var selectedServices: [ClinicService] {
        selectedIds.compactMap { id in activeServices.first { $0.id == id } }
    }

    private var selectedTotalMinor: Int {
        selectedServices.reduce(0) { $0 + $1.effective(in: branchId).priceMinor }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    content
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.top, KlinaraMetrics.sm)
                .padding(.bottom, KlinaraMetrics.lg)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(KlinaraColor.surface)
            .safeAreaInset(edge: .top, spacing: 0) {
                // Arama alanı listeyle birlikte kaymaz: uzun bir katalogda
                // aşağıdayken aramaya dönmek için en üste kaydırmak gerekiyordu.
                KlinaraSearchField(text: $searchText, placeholder: "Hizmet veya kategori ara")
                    .padding(.horizontal, KlinaraMetrics.screenInset)
                    .padding(.vertical, KlinaraMetrics.sm)
                    .background(KlinaraColor.surface)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if !selectedIds.isEmpty { addBar }
            }
            .animation(KlinaraMetrics.feedback, value: selectedIds.isEmpty)
            .navigationTitle("Hizmet ekle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .task { await store.load() }
        }
        .tint(KlinaraColor.sage)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: İçerik

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .loading:
            KlinaraSkeletonBody(style: .rowsShort)

        case .failed(let failure):
            ErrorBanner(error: failure, onRetry: { Task { await store.reload() } })

        case .loaded:
            if activeServices.isEmpty {
                EmptyStateView(
                    icon: "list.bullet.rectangle",
                    title: "Aktif hizmet yok",
                    message: "Pakete eklemek için önce Hizmetler ekranından hizmet tanımlayın."
                )
            } else if visibleServices.isEmpty {
                Text("“\(searchText)” ile eşleşen hizmet yok.")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, KlinaraMetrics.xl)
            } else {
                ForEach(store.catalog.grouped(visibleServices), id: \.category?.id) { group in
                    KlinaraCard(title: group.category?.name ?? "Kategorisiz") {
                        ForEach(Array(group.services.enumerated()), id: \.element.id) { index, service in
                            if index > 0 { KlinaraDivider() }
                            row(service)
                        }
                    }
                }
            }
        }
    }

    private func row(_ service: ClinicService) -> some View {
        let effective = service.effective(in: branchId)
        let isAdded = existingServiceIds.contains(service.id)
        let isSelected = selectedIds.contains(service.id)

        return Button {
            toggle(service)
        } label: {
            HStack(alignment: .center, spacing: KlinaraMetrics.md) {
                ColorDot(hex: service.calendarColor, size: 10)

                VStack(alignment: .leading, spacing: 2) {
                    Text(service.name)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(isAdded
                         ? "Pakette zaten var"
                         : "\(DurationFormat.format(minutes: effective.durationMinutes)) · \(Money.format(minor: effective.priceMinor))")
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .monospacedDigit()
                }

                selectionMark(isAdded: isAdded, isSelected: isSelected)
            }
            .padding(.horizontal, KlinaraMetrics.md)
            .padding(.vertical, 14)
            .background(isSelected ? KlinaraColor.sageSoft.opacity(0.35) : .clear)
            .contentShape(.rect)
            .opacity(isAdded ? 0.55 : 1)
        }
        .buttonStyle(.plain)
        .disabled(isAdded)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
        .accessibilityHint(isAdded ? "Bu hizmet pakette zaten var" : "")
    }

    @ViewBuilder
    private func selectionMark(isAdded: Bool, isSelected: Bool) -> some View {
        if isAdded {
            KlinaraBadge(text: "Eklendi", tone: .muted)
        } else {
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 22, weight: .regular))
                .foregroundStyle(isSelected ? KlinaraColor.sageDeep : KlinaraColor.border)
                .contentTransition(.symbolEffect(.replace))
                .accessibilityHidden(true)
        }
    }

    private var addBar: some View {
        VStack(spacing: KlinaraMetrics.sm) {
            HStack {
                Text("\(selectedIds.count) hizmet seçildi")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                Spacer()
                Text("Liste: \(Money.format(minor: selectedTotalMinor))")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .monospacedDigit()
            }
            KlinaraButton(
                title: selectedIds.count == 1 ? "Pakete ekle" : "\(selectedIds.count) hizmeti pakete ekle",
                kind: .primary,
                icon: "plus"
            ) {
                onAdd(selectedServices)
                dismiss()
            }
        }
        .padding(.horizontal, KlinaraMetrics.screenInset)
        .padding(.top, KlinaraMetrics.md)
        .padding(.bottom, KlinaraMetrics.sm)
        .background(
            KlinaraColor.surface
                .overlay(alignment: .top) {
                    Rectangle().fill(KlinaraColor.border).frame(height: KlinaraMetrics.borderWidth)
                }
                .ignoresSafeArea(edges: .bottom)
        )
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: Eylem

    private func toggle(_ service: ClinicService) {
        if let index = selectedIds.firstIndex(of: service.id) {
            selectedIds.remove(at: index)
        } else {
            selectedIds.append(service.id)
        }
    }
}
