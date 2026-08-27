import SwiftUI

/// Müşterinin birleşik zaman çizelgesi: randevu + not, tek akış.
///
/// Faz 3'te kartta ayrı bir randevu listesi vardı; zaman çizelgesi randevuları
/// zaten getirdiği için o istek kaldırıldı — ikisi birden aynı veriyi iki kez
/// çekerdi.
struct CustomerTimelineView: View {

    let session: AppSession
    let record: CustomerRecordStore
    /// Not satırına dokunulduğunda düzenlemeyi açar.
    var onEditNote: (String) -> Void

    private var clock: BranchClock { session.clock }

    var body: some View {
        switch record.timeline {
        case .loading:
            KlinaraCard(title: "Zaman çizelgesi") {
                ProgressView()
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity)
                    .padding(KlinaraMetrics.lg)
            }

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await record.loadTimeline() } })

        case .loaded(let entries):
            KlinaraCard(title: "Zaman çizelgesi", footnote: footnote) {
                if entries.isEmpty {
                    KlinaraRow(label: "Henüz kayıt yok")
                } else {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { KlinaraDivider() }
                        row(entry)
                    }
                }
            }

            if record.canLoadMore {
                loadMoreTrigger
            }
        }
    }

    /// Klinik notlar sunucudan hiç gelmiyorsa bunu söylemek gerekiyor:
    /// sessizce eksik bir geçmiş, tam bir geçmiş gibi görünürdü.
    private var footnote: String? {
        record.canReadMedical
            ? nil
            : "İşlem ve iç notlar bu rolde görüntülenemez; listede yer almazlar."
    }

    @ViewBuilder
    private func row(_ entry: TimelineEntry) -> some View {
        switch entry {
        case .appointment(let header, let payload):
            NavigationLink {
                AppointmentDetailView(session: session, entryId: header.id)
            } label: {
                KlinaraRow(
                    label: "Randevu",
                    detail: "\(clock.formatDateTime(payload.startsAt)) · "
                        + Money.format(minor: payload.totalMinor)
                ) {
                    KlinaraBadge(
                        text: payload.status.turkishName,
                        tone: payload.status.badgeTone
                    )
                }
            }
            .buttonStyle(.plain)

        case .note(let header, let payload):
            Button {
                onEditNote(header.id)
            } label: {
                KlinaraRow(
                    label: payload.body,
                    detail: "\(payload.kind.turkishName) · "
                        + clock.formatDateTime(entry.occurredAt)
                ) {
                    Image(systemName: payload.kind.icon)
                        .font(.system(size: 13))
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .buttonStyle(.plain)

        case .unknown(_, let kind):
            // Bilinmeyen olay YUTULMUYOR: sunucu yeni bir kol eklediğinde
            // (paket, tahsilat, onam) eski istemci geçmişi eksik göstermemeli.
            KlinaraRow(
                label: "Bu sürümde gösterilemeyen kayıt",
                detail: "\(kind) · \(clock.formatDateTime(entry.occurredAt))"
            ) {
                Image(systemName: "questionmark.circle")
                    .font(.system(size: 13))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
        }
    }

    private var loadMoreTrigger: some View {
        HStack {
            Spacer()
            ProgressView().tint(KlinaraColor.sage)
            Spacer()
        }
        .padding(.vertical, KlinaraMetrics.md)
        .onAppear { Task { await record.loadMoreTimeline() } }
    }
}
