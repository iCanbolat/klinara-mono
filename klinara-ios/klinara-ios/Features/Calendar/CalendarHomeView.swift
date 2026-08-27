import SwiftUI

/// "Bugün" sekmesinin kökü — günün takvimi.
///
/// Şube kapsamlıdır: `X-Branch-Id` olmadan `/calendar/day` `400` döner, bu
/// yüzden şube seçilmemişse veri hiç istenmez ve ekran bunu söyler.
///
/// Ajanda ve ızgara aynı veriyi iki farklı soruya cevap verecek biçimde çizer:
/// "sırada ne var" ve "nerede boşluk var".
struct CalendarHomeView: View {

    let session: AppSession

    @State private var selected: CalendarEntry?
    @State private var isBooking = false

    private var store: CalendarStore { session.calendarStore }
    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.appointmentWrite) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                header

                KlinaraScreen(
                    state: store.state,
                    onRetry: { await store.load(branchId: session.selectedBranchId, clock: clock) }
                ) { _ in
                    switch store.mode {
                    case .agenda:
                        AgendaListView(
                            clock: clock,
                            active: store.activeEntries,
                            terminal: store.terminalEntries,
                            staffColor: staffColor,
                            onSelect: { selected = $0 }
                        )
                    case .grid:
                        DayGridView(
                            clock: clock,
                            day: store.selectedDate,
                            entries: store.entries,
                            staffColor: staffColor,
                            onSelect: { selected = $0 }
                        )
                    }
                }
            }
            .background(KlinaraColor.surface)
            .navigationTitle(clock.formatDate(store.selectedDate))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .task(id: store.loadKey(clock: clock, branchId: session.selectedBranchId)) {
                async let calendar: Void = store.load(
                    branchId: session.selectedBranchId,
                    clock: clock
                )
                // Katalog ve personel yazma sonrası satır kurmak ve renk
                // bulmak için gerekiyor; ikisi de oturum ömürlü, ikinci kez
                // çekilmezler.
                async let catalog: Void = session.catalogStore.load()
                async let staff: Void = session.staffStore.load()
                async let customers: Void = session.customerStore.load()
                _ = await (calendar, catalog, staff, customers)
                store.cacheCustomers(session.customerStore.customers)
            }
            .refreshable {
                await store.load(branchId: session.selectedBranchId, clock: clock)
            }
            .sheet(item: $selected) { entry in
                AppointmentDetailView(session: session, entryId: entry.id)
            }
            .sheet(isPresented: $isBooking) {
                BookingFlowView(session: session, startingAt: nil)
            }
        }
        .tint(KlinaraColor.sage)
    }

    // MARK: Başlık

    private var header: some View {
        VStack(spacing: KlinaraMetrics.md) {
            CalendarDateStrip(
                clock: clock,
                selected: store.selectedDate,
                counts: dayCounts,
                onSelect: { store.select($0) }
            )

            HStack(spacing: KlinaraMetrics.md) {
                KlinaraSegmentedPicker(
                    options: CalendarStore.Mode.allCases,
                    selection: Binding(get: { store.mode }, set: { store.mode = $0 }),
                    title: \.turkishName,
                    icon: \.icon
                )

                if !clock.isToday(store.selectedDate) {
                    Button("Bugün") { store.goToToday() }
                        .klinaraText(.button)
                        .foregroundStyle(KlinaraColor.sageDeep)
                        .frame(height: 44)
                }
            }

            if !session.staffStore.profiles.isEmpty {
                staffFilterRow
            }
        }
        .padding(.horizontal, KlinaraMetrics.screenInset)
        .padding(.bottom, KlinaraMetrics.md)
        .background(KlinaraColor.surface)
    }

    private var staffFilterRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: KlinaraMetrics.sm) {
                filterChip(title: "Tümü", isSelected: store.staffFilter == nil) {
                    store.filter(staffProfileId: nil)
                }
                ForEach(session.staffStore.profiles.filter(\.isActive)) { profile in
                    filterChip(
                        title: profile.userFullName,
                        isSelected: store.staffFilter == profile.id
                    ) {
                        store.filter(staffProfileId: store.staffFilter == profile.id ? nil : profile.id)
                    }
                }
            }
        }
    }

    private func filterChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(isSelected ? KlinaraColor.surfaceRaised : KlinaraColor.charcoal)
                .padding(.horizontal, KlinaraMetrics.md)
                .frame(height: 34)
                .background(isSelected ? KlinaraColor.sageDeep : KlinaraColor.surfaceRaised)
                .overlay(
                    Capsule().stroke(
                        isSelected ? KlinaraColor.sageDeep : KlinaraColor.border,
                        lineWidth: KlinaraMetrics.borderWidth
                    )
                )
                .clipShape(.capsule)
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            BranchMenu(session: session)
        }

        if canWrite {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    isBooking = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Yeni randevu")
            }
        }
    }

    // MARK: Yardımcılar

    /// Şerit altındaki noktalar. Yalnız görüntülenen günün verisi elimizde
    /// olduğu için diğer günler boş görünür — haftalık sayıyı çekmek için ayrı
    /// bir istek atmak, şerit için fazla maliyet.
    private var dayCounts: [String: Int] {
        var counts: [String: Int] = [:]
        for entry in store.activeEntries {
            counts[clock.localDateString(entry.startsAt), default: 0] += 1
        }
        return counts
    }

    private func staffColor(_ staffProfileId: String) -> String? {
        session.staffStore.profile(id: staffProfileId)?.calendarColor
    }
}
