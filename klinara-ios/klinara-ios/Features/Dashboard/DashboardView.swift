import SwiftUI

/// Dashboard — web `/dashboard` paritesi ve uygulamanın AÇILIŞ sekmesi.
///
/// Sıra web ile aynı, "önce şimdi, sonra karşılaştırma": özet kart şeridi,
/// sıradaki randevular, personel cirosu, en altta şube grafiği.
///
/// Şube grafiği yatay çubuk; aynı anda TEK gösterge (birimler farklı: adet,
/// yüzde, para). Grafik `accessibilityHidden`, aynı sayılar altındaki
/// satırlarda.
struct DashboardView: View {

    let session: AppSession
    /// Takvim sekmesine geçer — "Sıradaki randevular → Tümünü gör".
    var onOpenCalendar: () -> Void = {}

    @State private var store: DashboardStore?
    @State private var picked: BranchMetric?
    /// Dokunulan sıradaki randevu — takvimin detay sheet'i AYNI ekranda açılır.
    @State private var selectedAppointment: UpcomingItem?
    /// Sekme her görünüşünde `.task` yeniden koşuyor; veri yalnız ilk açılışta
    /// ve şube değişiminde çekilir, sekmeler arası gidip gelmek istek atmaz.
    @State private var loadedGeneration: Int?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    header
                    if let store {
                        content(store)
                    } else {
                        KlinaraSkeletonBody(style: .report)
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("Dashboard")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                RootToolbarTitle(title: "Dashboard")
                ToolbarItem(placement: .topBarTrailing) {
                    BranchMenu(session: session)
                }
            }
            .refreshable { await store?.load() }
            // Takvimin kendi detay ekranı: durum, erteleme, iptal kuralları tek
            // yerde. Kapanınca özet yenilenir — durum değişikliği sayıları etkiler.
            .sheet(item: $selectedAppointment, onDismiss: {
                Task { await store?.load() }
            }) { item in
                AppointmentDetailView(session: session, entryId: item.id)
                    // Hizmet ve personel adları oturum ömürlü katalog/personel
                    // listelerinden çözülüyor; takvim açılmadan gelindiyse
                    // yüklü değiller ve satırda "Hizmet · Personel" kalıyordu.
                    .task {
                        async let catalog: Void = session.catalogStore.load()
                        async let staff: Void = session.staffStore.load()
                        _ = await (catalog, staff)
                    }
            }
        }
        .tint(KlinaraColor.sage)
        .task(id: session.branchGeneration) {
            guard loadedGeneration != session.branchGeneration else { return }
            loadedGeneration = session.branchGeneration
            let store = DashboardStore(
                booking: session.services.booking,
                reports: session.services.reports,
                branches: session.branches,
                access: DashboardAccess(can: session.can)
            )
            self.store = store
            await store.load()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            Text(session.isOwnScope
                 ? "Bugünüm, \(session.user.fullName.split(separator: " ").first.map(String.init) ?? "")"
                 : "Merhaba, \(session.user.fullName)")
                .klinaraText(.displayM)
                .foregroundStyle(KlinaraColor.charcoal)
            Text(Self.todayLabel(clock: session.clock))
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoalMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private static func todayLabel(clock: BranchClock, now: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "tr_TR")
        formatter.timeZone = clock.timeZone
        formatter.dateFormat = "d MMMM EEEE"
        return formatter.string(from: now)
    }

    @ViewBuilder
    private func content(_ store: DashboardStore) -> some View {
        if session.isOwnScope {
            // Uygulayıcı yönetici panosunu (şubeler, doluluk, personel cirosu)
            // değil kendi gününü görür — web `today-page.tsx` paritesi.
            todayContent(store)
        } else if store.access.isEmpty {
            EmptyStateView(
                icon: "chart.bar",
                title: "Özet erişiminiz yok",
                message: "Rolünüz randevu ya da rapor görüntülemeyi kapsamıyor."
            )
        } else if let snapshot = store.snapshot {
            KlinaraStatStrip(stats: Self.stats(snapshot, access: store.access))

            if let warning = warning(snapshot) {
                Text(warning)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.danger)
                    .accessibilityAddTraits(.updatesFrequently)
            }

            if store.access.calendar {
                upcomingCard(snapshot)
            }
            if store.access.staff {
                staffCard(snapshot)
            }
            if store.access.occupancy {
                branchCard(snapshot)
            }
        } else {
            // İlk yüklemede şerit yer tutucularla duruyor: içerik gelince sayfa zıplamasın.
            // Şerit ETİKETLERİNİ koruyor — hangi sayıların geleceğini söylemek,
            // gri bir kutudan daha çok şey anlatıyor; altındaki kartların ise
            // söyleyecek bir şeyi yok, onlar iskelet.
            KlinaraStatStrip(stats: Self.stats(nil, access: store.access), isLoading: true)
            if store.access.calendar {
                KlinaraSkeletonBody(style: .rowsShort)
            }
            KlinaraSkeletonBody(style: .chart)
        }
    }

    // MARK: Bugünüm (uygulayıcı)

    @ViewBuilder
    private func todayContent(_ store: DashboardStore) -> some View {
        let snapshot = store.snapshot
        KlinaraStatStrip(stats: Self.todayStats(snapshot, access: store.access), isLoading: snapshot == nil)
        if let snapshot {
            if let error = snapshot.calendarError {
                Text(error.displayMessage)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.danger)
            }
            nextCard(snapshot)
            dayCard(snapshot)
        } else {
            KlinaraSkeletonBody(style: .rowsShort)
        }
    }

    static func todayStats(_ snapshot: DashboardStore.Snapshot?, access: DashboardAccess) -> [KlinaraStat] {
        let today = snapshot?.today ?? []
        let active = today.filter { $0.entry.status != .cancelled && $0.entry.status != .noShow }
        let completed = today.filter { $0.entry.status == .completed }.count
        let next = snapshot?.upcoming.first
        let own = snapshot?.staffPerformance?.data.first
        let currency = snapshot?.staffPerformance?.currency ?? "TRY"
        var stats = [
            KlinaraStat(
                label: "Bugünkü randevularım",
                value: snapshot.map { _ in String(active.count) },
                icon: "calendar",
                hint: snapshot.map { _ in "\(completed) tamamlandı" }
            ),
            KlinaraStat(
                label: "Sıradaki",
                value: snapshot.map { _ in
                    next.map { BranchClock(timeZoneIdentifier: $0.timezone).formatTime($0.entry.startsAt) } ?? "—"
                },
                icon: "clock",
                hint: next?.entry.customerName
            ),
        ]
        if access.staff {
            stats.append(KlinaraStat(
                label: "Bu ay işlem",
                value: snapshot.map { _ in own.map { String($0.completedServices) } ?? "—" },
                icon: "checkmark.circle"
            ))
            stats.append(KlinaraStat(
                label: "Bu ay cirom",
                value: snapshot.map { _ in
                    own.map { Money.format(minor: $0.revenueMinor, currency: currency) } ?? "—"
                },
                icon: "banknote"
            ))
        }
        return stats
    }

    private func nextCard(_ snapshot: DashboardStore.Snapshot) -> some View {
        KlinaraCard(title: "Sıradaki hasta") {
            if let next = snapshot.upcoming.first {
                Button {
                    selectedAppointment = next
                } label: {
                    UpcomingRow(item: next, showsBranch: false, now: snapshot.fetchedAt)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Randevu ayrıntılarını açar")
            } else {
                KlinaraRow(label: "Yaklaşan randevunuz yok.")
            }
        }
    }

    private func dayCard(_ snapshot: DashboardStore.Snapshot) -> some View {
        let multiBranch = Set(snapshot.today.map(\.branchName)).count > 1
        return KlinaraCard(title: "Bugünün akışı") {
            if snapshot.today.isEmpty {
                KlinaraRow(label: "Bugün için randevunuz yok.")
            }
            ForEach(Array(snapshot.today.enumerated()), id: \.element.id) { index, item in
                if index > 0 { KlinaraDivider() }
                Button {
                    selectedAppointment = item
                } label: {
                    UpcomingRow(item: item, showsBranch: multiBranch, now: snapshot.fetchedAt)
                        .opacity(item.entry.endsAt < snapshot.fetchedAt ? 0.6 : 1)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Randevu ayrıntılarını açar")
            }
            if !snapshot.today.isEmpty {
                KlinaraDivider()
                Button(action: onOpenCalendar) {
                    SeeAllRow(label: "Takvimde aç", count: nil)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func warning(_ snapshot: DashboardStore.Snapshot) -> String? {
        let parts = [
            snapshot.calendarError.map { _ in "Bazı şubelerin bugünkü takvimi alınamadı." },
            snapshot.reportsError.map { _ in "Aylık özetler alınamadı." },
        ].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    // MARK: Özet

    /// Özet kartları — web KPI şeridiyle aynı dört kart, aynı izinlerle.
    /// Kaynağı düşen kartın değeri `nil` ("—"): kart yerinde kalır ki şerit
    /// düzeni hatadan hataya değişmesin.
    static func stats(_ snapshot: DashboardStore.Snapshot?, access: DashboardAccess) -> [KlinaraStat] {
        let totals = snapshot?.totals
        var stats: [KlinaraStat] = []
        if access.calendar {
            stats.append(KlinaraStat(
                label: "Bugünkü randevu",
                value: totals?.todayTotal.map(String.init),
                icon: "calendar",
                hint: totals.flatMap(todayDetail)
            ))
        }
        if access.occupancy {
            stats.append(KlinaraStat(
                label: "Bu ay doluluk",
                value: totals?.occupancyRate.map(ReportFormat.percent),
                icon: "gauge.with.needle",
                hint: deltaDetail(snapshot?.occupancyDelta)
            ))
        }
        if access.revenue {
            stats.append(KlinaraStat(
                label: "Bu ay ciro",
                value: totals.flatMap { totals in
                    totals.revenueMinor.map { Money.format(minor: $0, currency: totals.currency) }
                },
                icon: "banknote",
                hint: deltaDetail(snapshot?.revenueDelta)
            ))
        }
        if access.occupancy {
            stats.append(KlinaraStat(
                label: "Bu ay gelmeme",
                value: totals?.noShowRate.map(ReportFormat.percent),
                icon: "person.crop.circle.badge.xmark",
                hint: deltaDetail(snapshot?.noShowDelta)
            ))
        }
        return stats
    }

    private static func todayDetail(_ totals: DashboardTotals) -> String? {
        guard let active = totals.todayActive, let completed = totals.todayCompleted else { return nil }
        return "\(active) aktif · \(completed) tamamlandı"
    }

    private static func deltaDetail(_ value: Double?) -> String? {
        ReportFormat.delta(value).map { "Geçen aya göre \($0)" }
    }

    // MARK: Sıradaki randevular

    /// Tarihi en yakın randevular — bugünle sınırlı değil, en fazla
    /// ``DashboardSummaries/upcomingLimit`` kadar.
    ///
    /// Kart SINIRLI: her satır tek yükseklikte (ad ve hizmet tek satıra
    /// kırpılır). Fazlası varsa son satır takvime götürür. İç kaydırma YOK —
    /// sayfa zaten kayıyor ve iç içe kaydırma parmağın altında hangi listenin
    /// kaydığını belirsiz kılar.
    private func upcomingCard(_ snapshot: DashboardStore.Snapshot) -> some View {
        let upcoming = snapshot.upcoming
        let multiBranch = snapshot.summaries.count > 1
        return KlinaraCard(title: "Sıradaki randevular") {
            if upcoming.isEmpty {
                KlinaraRow(label: "Yaklaşan randevu yok.")
            }
            ForEach(Array(upcoming.enumerated()), id: \.element.id) { index, item in
                if index > 0 { KlinaraDivider() }
                Button {
                    selectedAppointment = item
                } label: {
                    UpcomingRow(item: item, showsBranch: multiBranch, now: snapshot.fetchedAt)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Randevu ayrıntılarını açar")
            }
            if snapshot.upcomingHasMore {
                KlinaraDivider()
                Button(action: onOpenCalendar) {
                    SeeAllRow(label: "Tümünü takvimde gör", count: nil)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Personel cirosu

    /// Bu ayın personel cirosu — en çoktan aza, önizleme kadar. Çubuk listenin
    /// en yükseğine göre ölçekli: sıralamayı göz ucuyla okutmak için, mutlak
    /// bir hedefi temsil etmiyor. Fazlası personel performansı raporunda.
    private func staffCard(_ snapshot: DashboardStore.Snapshot) -> some View {
        let report = snapshot.staffPerformance
        let all = DashboardSummaries.topStaffByRevenue(report)
        let rows = Array(all.prefix(DashboardSummaries.previewLimit))
        let peak = rows.first?.revenueMinor ?? 0
        let currency = report?.currency ?? "TRY"
        return KlinaraCard(
            title: Self.listTitle("Personel cirosu · Bu ay", count: all.count),
            footnote: report?.scope == .own ? "Yalnız kendi performansınızı görüyorsunuz." : nil
        ) {
            if rows.isEmpty {
                KlinaraRow(label: "Bu ay henüz tamamlanan işlem ya da ciro yok.")
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 { KlinaraDivider() }
                StaffRevenueRow(
                    name: row.staffName,
                    amount: Money.format(minor: row.revenueMinor, currency: currency),
                    services: row.completedServices,
                    fraction: peak == 0 ? 0 : Double(row.revenueMinor) / Double(peak)
                )
            }
            if all.count > rows.count {
                KlinaraDivider()
                NavigationLink {
                    DashboardStaffReport(session: session)
                } label: {
                    SeeAllRow(label: "Tümünü gör", count: "+\(all.count - rows.count) personel")
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// Başlıkta toplam: kırpılmış bir listenin kaç kayıttan kırpıldığı görünür
    /// olmalı.
    private static func listTitle(_ title: String, count: Int) -> String {
        count > 0 ? "\(title) · \(count)" : title
    }

    // MARK: Şubeler

    @ViewBuilder
    private func branchCard(_ snapshot: DashboardStore.Snapshot) -> some View {
        let summaries = snapshot.summaries
        let metrics = DashboardSummaries.availableMetrics(summaries)
        let currency = snapshot.totals.currency

        if summaries.isEmpty {
            KlinaraCard(title: "Şubeler") {
                EmptyStateView(
                    icon: "building.2",
                    title: "Şube bulunamadı",
                    message: "Erişebildiğiniz aktif bir şube yok."
                )
            }
        } else if let metric = picked.flatMap({ metrics.contains($0) ? $0 : nil }) ?? metrics.first {
            KlinaraCard(
                title: "Şubeler · \(metric == .today ? "Bugün" : "Bu ay")",
                footnote: "\(summaries.count) şube"
            ) {
                VStack(alignment: .leading, spacing: 0) {
                    if metrics.count > 1 {
                        KlinaraSegmentedPicker(
                            options: metrics,
                            selection: Binding(get: { metric }, set: { picked = $0 }),
                            title: \.label
                        )
                        .padding([.horizontal, .top], KlinaraMetrics.md)
                    }

                    KlinaraHorizontalBarChart(
                        rows: summaries.map { chartRow($0, metric: metric) },
                        series: series(metric),
                        format: { format(metric, $0, currency: currency) }
                    )

                    ForEach(summaries) { summary in
                        KlinaraDivider()
                        KlinaraRow(
                            label: summary.branch.name,
                            value: format(metric, DashboardSummaries.value(summary, metric), currency: currency)
                        )
                    }
                }
            }
        }
    }

    /// Bugün çubuğu üç parça: tamamlanan, bekleyen, iptal/gelmedi — web yığın
    /// çubuğunun aynısı.
    private func chartRow(_ summary: BranchDashboardSummary, metric: BranchMetric) -> KlinaraBarRow {
        let segments: [KlinaraBarSegment]
        if metric == .today {
            let today = summary.today
            segments = [
                KlinaraBarSegment(series: "Tamamlanan", value: Double(today?.completed ?? 0)),
                KlinaraBarSegment(
                    series: "Bekleyen",
                    value: Double((today?.active ?? 0) - (today?.completed ?? 0))
                ),
                KlinaraBarSegment(
                    series: "İptal / gelmedi",
                    value: Double((today?.total ?? 0) - (today?.active ?? 0))
                ),
            ]
        } else {
            segments = [
                KlinaraBarSegment(series: metric.label, value: DashboardSummaries.value(summary, metric)),
            ]
        }
        return KlinaraBarRow(id: summary.branch.id, label: summary.branch.name, segments: segments)
    }

    private func series(_ metric: BranchMetric) -> [KlinaraBarSeries] {
        if metric == .today {
            return [
                KlinaraBarSeries(name: "Tamamlanan", color: KlinaraColor.sageDeep),
                KlinaraBarSeries(name: "Bekleyen", color: KlinaraColor.sage),
                KlinaraBarSeries(name: "İptal / gelmedi", color: KlinaraColor.charcoalMuted.opacity(0.45)),
            ]
        }
        return [KlinaraBarSeries(name: metric.label, color: KlinaraColor.sageDeep)]
    }

    private func format(_ metric: BranchMetric, _ value: Double, currency: String) -> String {
        switch metric {
        case .today: return String(Int(value))
        case .occupancy, .noShow: return ReportFormat.percent(value)
        case .revenue: return Money.format(minor: Int(value), currency: currency)
        }
    }
}

/// Satırın altındaki ince oran çubuğu.
private struct ProportionBar: View {

    let fraction: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(KlinaraColor.border.opacity(0.5))
                Capsule()
                    .fill(KlinaraColor.sageDeep)
                    .frame(width: proxy.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }
}

/// Sıradaki randevu satırı — saat sütunu sabit genişlikte, ad ve hizmet tek
/// satır. Hizmet boşken de ikinci satır yer tutar: satır yükseklikleri eşit.
private struct UpcomingRow: View {

    let item: UpcomingItem
    let showsBranch: Bool
    let now: Date

    var body: some View {
        let detail = [item.entry.serviceSummary, showsBranch ? item.branchName : ""]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        HStack(spacing: KlinaraMetrics.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(BranchClock(timeZoneIdentifier: item.timezone).formatTime(item.entry.startsAt))
                    .klinaraText(.bodyEmphasis)
                    .monospacedDigit()
                    .foregroundStyle(KlinaraColor.charcoal)
                Text(DashboardSummaries.upcomingDayLabel(item.entry.startsAt, timezone: item.timezone, now: now))
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .lineLimit(1)
            }
            .frame(width: 52, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.entry.customerName)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .lineLimit(1)
                Text(detail)
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .lineLimit(1, reservesSpace: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            KlinaraBadge(text: item.entry.status.turkishName, tone: item.entry.status.badgeTone)
                .fixedSize()
        }
        .padding(KlinaraMetrics.md)
        .accessibilityElement(children: .combine)
    }
}

/// Personel cirosu satırı — ad kırpılır, tutar kırpılmaz; altında oran çubuğu
/// ve işlem sayısı. Çubuk içeriğin ALTINDA (üstüne bindirilmiyor).
private struct StaffRevenueRow: View {

    let name: String
    let amount: String
    let services: Int
    let fraction: Double

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(spacing: KlinaraMetrics.sm) {
                Text(name)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(amount)
                    .klinaraText(.bodyEmphasis)
                    .monospacedDigit()
                    .foregroundStyle(KlinaraColor.charcoal)
                    .lineLimit(1)
                    .fixedSize()
            }
            HStack(spacing: KlinaraMetrics.sm) {
                ProportionBar(fraction: fraction)
                Text("\(services) işlem")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .padding(KlinaraMetrics.md)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name), \(amount), \(services) işlem")
    }
}

/// "Tümünü gör" satırı — kartın son satırı, biliniyorsa fazlasının sayısıyla.
private struct SeeAllRow: View {

    let label: String
    let count: String?

    var body: some View {
        HStack(spacing: KlinaraMetrics.sm) {
            Text(label)
                .klinaraText(.bodyEmphasis)
                .foregroundStyle(KlinaraColor.sageDeep)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let count {
                Text(count)
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(KlinaraColor.charcoalMuted)
        }
        .padding(KlinaraMetrics.md)
        .contentShape(.rect)
    }
}

/// Personel performansı raporu, Dashboard'dan. Store burada `@State` — hedef
/// her yeniden çizimde yeniden kurulup dönemi sıfırlamasın. Şube `nil`: kart
/// "erişebildiğim tüm şubeler" üzerinden hesaplandı, sayılar tutmalı.
private struct DashboardStaffReport: View {

    let session: AppSession
    @State private var store: ReportsStore?

    var body: some View {
        Group {
            if let store {
                StaffPerformanceReportView(session: session, store: store)
            } else {
                Color.clear
            }
        }
        .onAppear {
            if store == nil {
                store = ReportsStore(service: session.services.reports, clock: session.clock, branchId: nil)
            }
        }
    }
}
