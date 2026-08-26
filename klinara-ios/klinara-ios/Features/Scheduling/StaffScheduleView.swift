import SwiftUI

/// Personelin bir şubedeki haftalık çalışma şablonu.
///
/// ``BranchHoursView`` ile aynı desen: `PUT` haftanın tamamını değiştirir,
/// ekran taslak tutar ve tek seferde gönderir.
struct StaffScheduleView: View {

    let session: AppSession
    let staffProfileId: String

    @State private var state: LoadState<[Weekday: DayDraft]> = .loading
    @State private var original: [Weekday: DayDraft] = [:]
    @State private var error: APIError?
    @State private var isSaving = false
    @State private var saved = false

    private var canWrite: Bool { session.can(Permissions.scheduleWrite) }
    private var clock: BranchClock { session.clock }

    struct DayDraft: Equatable {
        var isOff: Bool
        var start: ClockTime
        var end: ClockTime
    }

    var body: some View {
        ZStack {
            KlinaraColor.surface.ignoresSafeArea()
            content
        }
        .navigationTitle("Haftalık program")
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
                        Text("Program kaydedildi.")
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.sageDeep)
                    }

                    Text("\(session.selectedBranch?.name ?? "Şube") için geçerli. Personel başka şubede de çalışıyorsa oranın programı ayrı tutulur.")
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .fixedSize(horizontal: false, vertical: true)

                    KlinaraCard {
                        ForEach(Array(Weekday.displayOrder.enumerated()), id: \.element.id) { index, weekday in
                            if index > 0 { KlinaraDivider() }
                            dayRows(weekday, draft: days[weekday] ?? Self.defaultDraft)
                        }
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
        }
    }

    private func dayRows(_ weekday: Weekday, draft: DayDraft) -> some View {
        let binding = Binding<DayDraft>(
            get: { state.value?[weekday] ?? Self.defaultDraft },
            set: { updated in
                guard var days = state.value else { return }
                days[weekday] = updated
                state = .loaded(days)
            }
        )

        return VStack(spacing: 0) {
            KlinaraToggleRow(
                label: weekday.turkishName,
                detail: draft.isOff
                    ? "İzinli"
                    : "\(draft.start.displayValue) – \(draft.end.displayValue)",
                isOn: Binding(get: { !binding.wrappedValue.isOff }, set: { binding.isOff.wrappedValue = !$0 }),
                isEnabled: canWrite
            )

            if !draft.isOff {
                KlinaraTimeField(
                    label: "Başlangıç",
                    time: Binding(get: { binding.wrappedValue.start }, set: { binding.start.wrappedValue = $0 ?? ClockTime(hour: 10, minute: 0) }),
                    isEnabled: canWrite,
                    timeZone: clock.timeZone
                )
                KlinaraTimeField(
                    label: "Bitiş",
                    time: Binding(get: { binding.wrappedValue.end }, set: { binding.end.wrappedValue = $0 ?? .sixPM }),
                    isEnabled: canWrite,
                    timeZone: clock.timeZone
                )
            }
        }
    }

    // MARK: Durum

    private var isDirty: Bool {
        guard let days = state.value else { return false }
        return days != original
    }

    private static let defaultDraft = DayDraft(
        isOff: false,
        start: ClockTime(hour: 10, minute: 0),
        end: .sixPM
    )

    private func load() async {
        guard let branchId = session.selectedBranchId else {
            state = .failed(.problem(ProblemDetails(
                code: .validationFailed,
                title: "Şube seçilmedi",
                detail: "Programı görüntülemek için bir şube seçin.",
                status: 400
            )))
            return
        }

        state = .loading
        error = nil
        saved = false
        do {
            let schedule = try await session.services.scheduling.staffSchedule(
                staffProfileId: staffProfileId,
                branchId: branchId
            )
            var days: [Weekday: DayDraft] = [:]
            for weekday in Weekday.allCases {
                days[weekday] = draft(from: schedule.entries.first { $0.dayOfWeek == weekday.rawValue })
            }
            state = .loaded(days)
            original = days
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    private func draft(from entry: StaffScheduleEntry?) -> DayDraft {
        guard let entry else { return Self.defaultDraft }
        return DayDraft(
            isOff: entry.isOff,
            start: ClockTime(entry.startTime) ?? ClockTime(hour: 10, minute: 0),
            end: ClockTime(entry.endTime) ?? .sixPM
        )
    }

    private func save() async {
        guard let branchId = session.selectedBranchId, let days = state.value else { return }
        error = nil
        saved = false
        isSaving = true
        defer { isSaving = false }

        let entries = Weekday.allCases.map { weekday -> StaffScheduleEntryInput in
            let day = days[weekday] ?? Self.defaultDraft
            return StaffScheduleEntryInput(
                dayOfWeek: weekday.rawValue,
                isOff: day.isOff,
                startTime: day.isOff ? nil : day.start.wireValue,
                endTime: day.isOff ? nil : day.end.wireValue
            )
        }

        do {
            let updated = try await session.services.scheduling.replaceStaffSchedule(
                staffProfileId: staffProfileId,
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
