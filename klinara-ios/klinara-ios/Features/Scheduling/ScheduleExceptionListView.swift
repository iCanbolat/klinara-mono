import SwiftUI

/// İzin ve istisna kayıtları.
///
/// Personel detayından açıldığında tek personele filtrelenir; Yönetim
/// sekmesinden açıldığında şubenin tamamını gösterir.
struct ScheduleExceptionListView: View {

    let session: AppSession
    var staffProfileId: String?

    @State private var state: LoadState<[ScheduleException]> = .loading
    @State private var rangeDays = 30
    @State private var showsEditor = false
    @State private var pendingDeletion: ScheduleException?
    @State private var actionError: APIError?

    private var canWrite: Bool { session.can(Permissions.scheduleWrite) }
    private var clock: BranchClock { session.clock }

    var body: some View {
        KlinaraScreen(
            state: state,
            emptyCheck: \.isEmpty,
            emptyTitle: "İstisna yok",
            emptyMessage: "Seçilen aralıkta izin, tatil veya özel açılış kaydı bulunmuyor.",
            emptyIcon: "calendar.badge.exclamationmark",
            onRetry: { await load() }
        ) { items in
            if let actionError { ErrorBanner(error: actionError) }

            KlinaraCard(footnote: "Kayıtlar \(clock.timeZone.identifier) saat diliminde gösterilir.") {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { KlinaraDivider() }
                    row(for: item)
                }
            }
        }
        .navigationTitle("İzin ve istisnalar")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Aralık", selection: $rangeDays) {
                        Text("30 gün").tag(30)
                        Text("90 gün").tag(90)
                        Text("1 yıl").tag(365)
                    }
                    if canWrite {
                        Button {
                            showsEditor = true
                        } label: {
                            Label("Yeni istisna", systemImage: "plus")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Seçenekler")
            }
        }
        .task(id: taskKey) { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showsEditor) {
            ScheduleExceptionEditorView(
                session: session,
                presetStaffProfileId: staffProfileId,
                onSaved: { Task { await load() } }
            )
        }
        .confirmationDialog(
            "İstisna kaldırılsın mı?",
            isPresented: .init(
                get: { pendingDeletion != nil },
                set: { if !$0 { pendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Kaldır", role: .destructive) {
                guard let target = pendingDeletion else { return }
                pendingDeletion = nil
                Task { await delete(target) }
            }
            Button("Vazgeç", role: .cancel) { pendingDeletion = nil }
        } message: {
            Text("Kayıt silinmez, pasife alınır. Personel bu aralıkta yeniden müsait olur.")
        }
    }

    /// Şube ve aralık değişimi listeyi yeniden çeker.
    private var taskKey: String {
        "\(session.selectedBranchId ?? "-")|\(rangeDays)|\(staffProfileId ?? "-")"
    }

    private func row(for item: ScheduleException) -> some View {
        let staffName = session.staffStore.profile(id: item.staffProfileId)?.userFullName
            ?? "Personel"

        return KlinaraRow(
            label: staffName,
            detail: clock.formatRange(from: item.startsAt, to: item.endsAt)
        ) {
            HStack(spacing: KlinaraMetrics.sm) {
                if item.recurrenceType == .weekly {
                    KlinaraBadge(text: recurrenceLabel(item), tone: .neutral, icon: "repeat")
                }
                if let reason = item.reason, !reason.isEmpty {
                    KlinaraBadge(text: reason, tone: .muted)
                }
            }
        }
        .swipeActions(edge: .trailing) {
            if canWrite {
                Button(role: .destructive) {
                    pendingDeletion = item
                } label: {
                    Label("Kaldır", systemImage: "trash")
                }
            }
        }
    }

    private func recurrenceLabel(_ item: ScheduleException) -> String {
        guard !item.recurrenceWeekdays.isEmpty else {
            return item.recurrenceIntervalWeeks == 1
                ? "Her hafta"
                : "\(item.recurrenceIntervalWeeks) haftada bir"
        }
        let names = item.recurrenceWeekdays
            .compactMap { Weekday(rawValue: $0)?.shortName }
            .joined(separator: ", ")
        return names
    }

    private func load() async {
        guard let branchId = session.selectedBranchId else {
            state = .failed(.problem(ProblemDetails(
                code: .validationFailed,
                title: "Şube seçilmedi",
                detail: "İstisnaları görüntülemek için bir şube seçin.",
                status: 400
            )))
            return
        }

        state = .loading
        actionError = nil
        do {
            // Personel adlarını gösterebilmek için profiller de gerekiyor.
            await session.staffStore.load()
            let now = Date()
            let items = try await session.services.scheduling.scheduleExceptions(
                ScheduleExceptionQuery(
                    branchId: branchId,
                    staffProfileId: staffProfileId,
                    from: clock.startOfDay(now),
                    to: clock.adding(days: rangeDays, to: now)
                )
            )
            state = .loaded(items)
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    private func delete(_ item: ScheduleException) async {
        actionError = nil
        do {
            try await session.services.scheduling.deleteScheduleException(id: item.id)
            await load()
        } catch {
            actionError = error as? APIError ?? .network
        }
    }
}
