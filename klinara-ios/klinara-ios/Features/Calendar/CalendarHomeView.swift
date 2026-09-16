import SwiftUI

/// "Takvim" sekmesinin kökü — günün takvimi.
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
                        dayGrid
                    case .week:
                        WeekGridView(
                            clock: clock,
                            days: clock.weekDays(of: store.selectedDate),
                            selectedDay: store.selectedDate,
                            entries: store.entries,
                            density: store.densityByDay,
                            densityPeak: store.densityPeak,
                            densityNote: densityNote,
                            staffColor: staffColor,
                            onSelect: { selected = $0 },
                            // Bir güne dokunmak o güne GEÇMİYOR, yalnız seçili
                            // günü değiştiriyor: hafta görünümünden çıkmadan
                            // gün seçmek, moda geri dönüldüğünde nereye
                            // düşüleceğini belirliyor.
                            onSelectDay: { store.select($0) }
                        )
                    }
                }
            }
            .background(KlinaraColor.surface)
            .navigationTitle(title)
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

    /// Gün ızgarası, üstünde o günün saatlik yoğunluk şeridiyle.
    ///
    /// Şerit ızgaranın kendisini tekrar etmiyor: bloklar **kimin** randevusu
    /// olduğunu, şerit **kaç** randevu olduğunu söylüyor. Personel filtresi
    /// açıkken ikisi ayrışıyor ve lejant bunu yazıyor.
    private var dayGrid: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            if store.densityPeak > 0 {
                DensityStrip(
                    counts: store.densityByDay[clock.localDateString(store.selectedDate)] ?? [:],
                    hours: CalendarBlockLayout.hours(for: store.entries, clock: clock),
                    peak: store.densityPeak
                )
                DensityLegend(peak: store.densityPeak, note: densityNote)
            }

            DayGridView(
                clock: clock,
                day: store.selectedDate,
                entries: store.entries,
                staffColor: staffColor,
                onSelect: { selected = $0 }
            )
        }
    }

    /// Sunucu yoğunluğu personel filtresine göre daraltmıyor
    /// (`calendar.repository.ts:loadDensity`). Filtre açıkken bloklarla ısının
    /// ayrıştığını söylememek, kullanıcıyı "bu personel bu saatte dolu"
    /// sonucuna götürürdü.
    private var densityNote: String? {
        store.staffFilter == nil ? nil : "şube geneli"
    }

    // MARK: Başlık

    private var header: some View {
        VStack(spacing: KlinaraMetrics.md) {
            // Mod seçici ilk satırda ve tek başına: altındaki gezinme satırının
            // ne kaydırdığı (gün mü hafta mı) önce burada belirleniyor.
            HStack(spacing: KlinaraMetrics.sm) {
                KlinaraSegmentedPicker(
                    options: CalendarStore.Mode.allCases,
                    selection: Binding(get: { store.mode }, set: { store.mode = $0 }),
                    title: \.turkishName,
                    icon: \.icon
                )

                // "Bugün" yalnız bugünde DEĞİLKEN görünür; seçici yer açmak için
                // animasyonla daralır, gezinme satırının genişliği hiç değişmez.
                if !clock.isToday(store.selectedDate) {
                    Button("Bugün") { store.goToToday() }
                        .klinaraText(.button)
                        .foregroundStyle(KlinaraColor.sageDeep)
                        .frame(height: 44)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .animation(KlinaraMetrics.feedback, value: clock.isToday(store.selectedDate))

            // Oklar kaydırdıkları şeyin iki yanında: gün modlarında şeridin,
            // hafta modunda hafta aralığının.
            HStack(spacing: KlinaraMetrics.xs) {
                stepButton(-1, icon: "chevron.left", label: previousLabel)

                if store.mode == .week {
                    Text(title)
                        .klinaraText(.button)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .accessibilityAddTraits(.isHeader)
                } else {
                    CalendarDateStrip(
                        clock: clock,
                        selected: store.selectedDate,
                        counts: dayCounts,
                        onSelect: { store.select($0) }
                    )
                }

                stepButton(1, icon: "chevron.right", label: nextLabel)
            }

            if !session.staffStore.profiles.isEmpty {
                staffFilterRow
            }
        }
        .padding(.horizontal, KlinaraMetrics.screenInset)
        .padding(.bottom, KlinaraMetrics.md)
        .background(KlinaraColor.surface)
    }

    /// İleri/geri. Şerit seçili günü ortalıyor; ok bir gün kaydırınca şerit de
    /// tam bir hücre kayıyor. Hafta ızgarasında da kaydırılamayan bir hafta
    /// planlamaya yaramazdı.
    ///
    /// Adım modun kendi adımı: hafta görünümünde bir gün ilerlemek çoğu zaman
    /// aynı haftada kalıp hiçbir şeyi değiştirmezdi.
    private func stepButton(_ direction: Int, icon: String, label: String) -> some View {
        Button { store.step(direction, clock: clock) } label: {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(KlinaraColor.sageDeep)
                .frame(width: 32, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var previousLabel: String { store.mode == .week ? "Önceki hafta" : "Önceki gün" }
    private var nextLabel: String { store.mode == .week ? "Sonraki hafta" : "Sonraki gün" }

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

    /// Şerit altındaki noktalar.
    ///
    /// Hafta modunda yanıt haftanın tamamının `density[]`ini taşıyor ve
    /// noktalar ilk kez yedi gün için de doğru. Gün modunda elde yalnız o günün
    /// verisi var; haftalık sayı için ikinci bir istek atmak, bir nokta uğruna
    /// fazla maliyet.
    private var dayCounts: [String: Int] {
        if store.mode == .week { return store.countsByDay }
        var counts: [String: Int] = [:]
        for entry in store.activeEntries {
            counts[clock.localDateString(entry.startsAt), default: 0] += 1
        }
        return counts
    }

    /// Hafta modunda tek bir gün yazmak yanıltıcı: ekranda yedi gün var.
    private var title: String {
        guard store.mode == .week else { return clock.formatDate(store.selectedDate) }
        let days = clock.weekDays(of: store.selectedDate)
        guard let first = days.first, let last = days.last else {
            return clock.formatDate(store.selectedDate)
        }
        return "\(clock.dayNumber(first)) – \(clock.formatDate(last))"
    }

    private func staffColor(_ staffProfileId: String) -> String? {
        session.staffStore.profile(id: staffProfileId)?.calendarColor
    }
}
