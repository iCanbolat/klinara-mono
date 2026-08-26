import SwiftUI

/// Şube haftalık çalışma saatleri.
///
/// `PUT` haftanın tamamını değiştirdiği için ekran yerel taslak tutar ve tek
/// "Kaydet" ile gönderir. Gün başına otomatik kayıt, yarım kalan bir istekte
/// haftanın geri kalanını silerdi.
struct BranchHoursView: View {

    let session: AppSession

    @State private var state: LoadState<[Weekday: DayDraft]> = .loading
    @State private var original: [Weekday: DayDraft] = [:]
    @State private var error: APIError?
    @State private var isSaving = false
    @State private var saved = false

    private var canWrite: Bool { session.can(Permissions.scheduleWrite) }
    private var clock: BranchClock { session.clock }

    struct DayDraft: Equatable {
        var isClosed: Bool
        var open: ClockTime
        var close: ClockTime
        var hasBreak: Bool
        var breakStart: ClockTime
        var breakEnd: ClockTime
    }

    var body: some View {
        ZStack {
            KlinaraColor.surface.ignoresSafeArea()
            content
        }
        .navigationTitle("Çalışma saatleri")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if canWrite, isDirty {
                    Button("Kaydet") { Task { await save() } }
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.sageDeep)
                        .disabled(isSaving)
                } else {
                    BranchMenu(session: session)
                }
            }
        }
        // Şube değişince veri yeniden çekilir: aksi hâlde kullanıcı Kadıköy'ü
        // seçip Nişantaşı'nın saatlerini düzenlemeye devam ederdi.
        .task(id: session.selectedBranchId) { await load() }
        .overlay {
            if isSaving { AuthLoadingOverlay(message: "Kaydediliyor…") }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            ProgressView().tint(KlinaraColor.sage).frame(maxWidth: .infinity, maxHeight: .infinity)

        case .failed(let failure):
            VStack {
                ErrorBanner(error: failure, onRetry: { Task { await load() } })
                Spacer()
            }
            .padding(KlinaraMetrics.screenInset)

        case .loaded(let days):
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped { ErrorBanner(error: error) }
                    if saved {
                        Text("Çalışma saatleri kaydedildi.")
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.sageDeep)
                    }

                    Text("Saatler \(session.selectedBranch?.name ?? "şube") saat diliminde (\(clock.timeZone.identifier)) gösterilir ve saklanır.")
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .fixedSize(horizontal: false, vertical: true)

                    ForEach(Weekday.displayOrder) { weekday in
                        dayCard(weekday, draft: days[weekday] ?? Self.defaultDraft)
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
        }
    }

    private func dayCard(_ weekday: Weekday, draft: DayDraft) -> some View {
        let binding = Binding<DayDraft>(
            get: { state.value?[weekday] ?? Self.defaultDraft },
            set: { updated in
                guard var days = state.value else { return }
                days[weekday] = updated
                state = .loaded(days)
            }
        )

        return KlinaraCard(title: weekday.turkishName) {
            KlinaraToggleRow(
                label: "Kapalı",
                isOn: binding.isClosed,
                isEnabled: canWrite
            )

            if !draft.isClosed {
                KlinaraDivider()
                KlinaraTimeField(
                    label: "Açılış",
                    time: Binding(get: { binding.wrappedValue.open }, set: { binding.open.wrappedValue = $0 ?? .nineAM }),
                    isEnabled: canWrite,
                    timeZone: clock.timeZone
                )
                KlinaraDivider()
                KlinaraTimeField(
                    label: "Kapanış",
                    time: Binding(get: { binding.wrappedValue.close }, set: { binding.close.wrappedValue = $0 ?? .sixPM }),
                    isEnabled: canWrite,
                    timeZone: clock.timeZone
                )
                KlinaraDivider()
                KlinaraToggleRow(label: "Mola", isOn: binding.hasBreak, isEnabled: canWrite)

                if draft.hasBreak {
                    KlinaraDivider()
                    KlinaraTimeField(
                        label: "Mola başlangıcı",
                        time: Binding(get: { binding.wrappedValue.breakStart }, set: { binding.breakStart.wrappedValue = $0 ?? ClockTime(hour: 13, minute: 0) }),
                        isEnabled: canWrite,
                        timeZone: clock.timeZone
                    )
                    KlinaraDivider()
                    KlinaraTimeField(
                        label: "Mola bitişi",
                        time: Binding(get: { binding.wrappedValue.breakEnd }, set: { binding.breakEnd.wrappedValue = $0 ?? ClockTime(hour: 14, minute: 0) }),
                        isEnabled: canWrite,
                        timeZone: clock.timeZone
                    )
                }

                if canWrite {
                    KlinaraDivider()
                    Button {
                        applyToAllDays(from: draft)
                    } label: {
                        KlinaraRow(label: "Bu saatleri tüm günlere uygula") {
                            Image(systemName: "arrow.down.doc")
                                .font(.system(size: 14))
                                .foregroundStyle(KlinaraColor.sageDeep)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: Durum

    private var isDirty: Bool {
        guard let days = state.value else { return false }
        return days != original
    }

    private static let defaultDraft = DayDraft(
        isClosed: false,
        open: .nineAM,
        close: .sixPM,
        hasBreak: false,
        breakStart: ClockTime(hour: 13, minute: 0),
        breakEnd: ClockTime(hour: 14, minute: 0)
    )

    private func applyToAllDays(from source: DayDraft) {
        guard var days = state.value else { return }
        for weekday in Weekday.allCases where !(days[weekday]?.isClosed ?? false) {
            days[weekday] = source
        }
        state = .loaded(days)
    }

    private func load() async {
        guard let branchId = session.selectedBranchId else {
            state = .failed(.problem(ProblemDetails(
                code: .validationFailed,
                title: "Şube seçilmedi",
                detail: "Çalışma saatlerini görüntülemek için bir şube seçin.",
                status: 400
            )))
            return
        }

        state = .loading
        error = nil
        saved = false
        do {
            let hours = try await session.services.scheduling.branchHours(branchId: branchId)
            var days: [Weekday: DayDraft] = [:]
            for weekday in Weekday.allCases {
                let entry = hours.entries.first { $0.dayOfWeek == weekday.rawValue }
                days[weekday] = draft(from: entry)
            }
            state = .loaded(days)
            original = days
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    private func draft(from entry: BranchHour?) -> DayDraft {
        guard let entry else { return Self.defaultDraft }
        let breakStart = ClockTime(entry.breakStartTime)
        let breakEnd = ClockTime(entry.breakEndTime)
        return DayDraft(
            isClosed: entry.isClosed,
            open: ClockTime(entry.openTime) ?? .nineAM,
            close: ClockTime(entry.closeTime) ?? .sixPM,
            hasBreak: breakStart != nil && breakEnd != nil,
            breakStart: breakStart ?? ClockTime(hour: 13, minute: 0),
            breakEnd: breakEnd ?? ClockTime(hour: 14, minute: 0)
        )
    }

    private func save() async {
        guard let branchId = session.selectedBranchId, let days = state.value else { return }
        error = nil
        saved = false
        isSaving = true
        defer { isSaving = false }

        let entries = Weekday.allCases.map { weekday -> BranchHourInput in
            let day = days[weekday] ?? Self.defaultDraft
            return BranchHourInput(
                dayOfWeek: weekday.rawValue,
                isClosed: day.isClosed,
                // Kapalı günde saat göndermiyoruz: sunucu için "kapalı" tek
                // başına yeterli bir ifade, saatler yalnız gürültü olurdu.
                openTime: day.isClosed ? nil : day.open.wireValue,
                closeTime: day.isClosed ? nil : day.close.wireValue,
                breakStartTime: day.isClosed || !day.hasBreak ? nil : day.breakStart.wireValue,
                breakEndTime: day.isClosed || !day.hasBreak ? nil : day.breakEnd.wireValue
            )
        }

        do {
            let updated = try await session.services.scheduling.replaceBranchHours(
                branchId: branchId,
                entries: entries
            )
            var refreshed: [Weekday: DayDraft] = [:]
            for weekday in Weekday.allCases {
                refreshed[weekday] = draft(from: updated.entries.first { $0.dayOfWeek == weekday.rawValue })
            }
            state = .loaded(refreshed)
            original = refreshed
            saved = true
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
