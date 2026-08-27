import SwiftUI

/// Bir notun düzenleme geçmişi — salt okunur.
///
/// Satırlar düzenlemeden **önceki** metinlerdir: trigger her metin değişiminde
/// eski gövdeyi saklıyor. En üstte güncel metin duruyor ki kullanıcı neyin
/// neye dönüştüğünü tek ekranda görebilsin.
struct NoteRevisionsView: View {

    let session: AppSession
    let record: CustomerRecordStore
    let note: CustomerNote

    @Environment(\.dismiss) private var dismiss
    @State private var state: LoadState<[CustomerNoteRevision]> = .loading

    private var clock: BranchClock { session.clock }

    var body: some View {
        NavigationStack {
            KlinaraScreen(
                state: state,
                onRetry: { await load() }
            ) { revisions in
                KlinaraCard(title: "Güncel metin", footnote: "Sürüm \(note.version)") {
                    KlinaraRow(label: note.body, detail: clock.formatDateTime(note.updatedAt))
                }

                KlinaraCard(
                    title: "Önceki sürümler",
                    footnote: "Her satır, düzenlemeden ÖNCEKİ metindir."
                ) {
                    if revisions.isEmpty {
                        KlinaraRow(label: "Kayıt yok")
                    } else {
                        ForEach(Array(revisions.enumerated()), id: \.element.id) { index, revision in
                            if index > 0 { KlinaraDivider() }
                            KlinaraRow(
                                label: revision.body,
                                detail: "Sürüm \(revision.version) · "
                                    + clock.formatDateTime(revision.editedAt)
                            )
                        }
                    }
                }
            }
            .navigationTitle("Düzenleme geçmişi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Kapat") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .task { await load() }
        }
        .tint(KlinaraColor.sage)
    }

    private func load() async {
        state = .loading
        do {
            state = .loaded(try await record.revisions(noteId: note.id))
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }
}
