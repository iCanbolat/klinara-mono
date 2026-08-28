import SwiftUI

/// Randevunun bildirim çizelgesi — hangi hatırlatma ne zaman gidecek, gitti mi.
///
/// `cancelled` ve `superseded` satırları da gösterilir; sunucu onları bilerek
/// döndürüyor (Ek M). Yalnız `pending` satırları göstermek, randevu
/// ertelendiğinde eski planın nereye gittiği sorusunu cevapsız bırakırdı —
/// ve kullanıcı "hatırlatma kayboldu" diye destek çağırırdı.
///
/// Yazma yok: hatırlatmalar randevunun kendi transaction'ında planlanıyor ve
/// tek tek iptal edilemiyor. Ekran bu yüzden salt okunur, ve düzenleme
/// isteyeni hatırlatma ayarlarına yönlendiriyor.
struct AppointmentNotificationsSection: View {

    let session: AppSession
    let appointmentId: String

    @State private var state: LoadState<[ScheduledNotification]> = .loading

    var body: some View {
        KlinaraCard(
            title: "Bildirimler",
            footnote: "Hatırlatma saatleri şube ayarından gelir. Randevu ertelenirse eski plan düşer, yenisi kurulur."
        ) {
            content
        }
        .task(id: appointmentId) { await load() }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            ProgressView()
                .tint(KlinaraColor.sage)
                .frame(maxWidth: .infinity)
                .padding(KlinaraMetrics.lg)

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await load() } })

        case .loaded(let rows):
            if rows.isEmpty {
                Text("Bu randevu için planlanmış bildirim yok.")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(KlinaraMetrics.md)
            } else {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { KlinaraDivider() }
                    notificationRow(row)
                }
            }
        }
    }

    private func notificationRow(_ row: ScheduledNotification) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(spacing: KlinaraMetrics.sm) {
                Text(row.event.turkishName)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity, alignment: .leading)

                KlinaraBadge(text: row.status.turkishName, tone: row.status.badgeTone)
            }

            Text("\(row.offsetLabel) · \(session.clock.formatDateTime(row.scheduledFor))")
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(KlinaraMetrics.md)
    }

    private func load() async {
        state = .loading
        do {
            state = .loaded(
                try await session.services.notifications
                    .appointmentNotifications(appointmentId: appointmentId)
            )
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }
}
