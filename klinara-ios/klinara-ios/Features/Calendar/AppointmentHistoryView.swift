import SwiftUI

/// Randevunun denetim izi — salt okunur, ekleme yapılamaz.
///
/// Zaman damgaları burada **UTC** gelir (randevunun kendi saatleri şube
/// offset'liyken); ``BranchClock`` ikisini de şube saatinde gösterdiği için
/// kullanıcı farkı görmez, ama çözümlemenin ikisini de kabul etmesi gerekiyor.
struct AppointmentHistoryView: View {

    let session: AppSession
    let appointmentId: String

    @State private var state: LoadState<[AppointmentHistoryEntry]> = .loading

    private var clock: BranchClock { session.clock }

    var body: some View {
        KlinaraScreen(
            state: state,
            emptyCheck: \.isEmpty,
            emptyTitle: "Kayıt yok",
            emptyMessage: "Bu randevu için henüz bir olay kaydedilmemiş.",
            emptyIcon: "clock.arrow.circlepath",
            onRetry: load
        ) { entries in
            KlinaraCard {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { KlinaraDivider() }
                    KlinaraRow(
                        label: entry.action.turkishName,
                        value: clock.formatDateTime(entry.createdAt),
                        detail: detail(for: entry)
                    )
                }
            }
        }
        .navigationTitle("Geçmiş")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        state = .loading
        do {
            state = .loaded(try await session.calendarStore.history(id: appointmentId))
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    private func detail(for entry: AppointmentHistoryEntry) -> String? {
        var parts: [String] = []
        if let from = entry.fromStatus, let to = entry.toStatus {
            parts.append("\(from.turkishName) → \(to.turkishName)")
        } else if let to = entry.toStatus {
            parts.append(to.turkishName)
        }
        if let old = entry.oldStartsAt, let new = entry.newStartsAt {
            parts.append("\(clock.formatDateTime(old)) → \(clock.formatDateTime(new))")
        }
        if let reason = entry.reason { parts.append(reason) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
