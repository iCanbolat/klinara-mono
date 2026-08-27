import SwiftUI

/// Tam boyut fotoğraf.
///
/// Bu ekranın her açılışı `download-url?variant=original` çağırıyor ve
/// `customer_record_access_log`a **`download`** olarak düşüyor (KVKK m.6).
/// Izgaradaki küçük görsel ise `view` olarak düşer; ikisini ayırmak, "kim
/// gerçekten dosyayı açtı" sorusunun cevabını kaydırma gürültüsünden kurtarıyor.
struct PhotoDetailView: View {

    let session: AppSession
    let record: CustomerRecordStore
    let thumbnails: ThumbnailCache
    let file: CustomerFile

    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var error: APIError?
    @State private var deleting = false
    @State private var zoom: CGFloat = 1

    private var clock: BranchClock { session.clock }
    private var canDelete: Bool { session.can(Permissions.customerMedicalWrite) }

    var body: some View {
        NavigationStack {
            ZStack {
                KlinaraColor.charcoal.ignoresSafeArea()

                if let error {
                    ErrorBanner(error: error, onRetry: { Task { await load() } })
                        .padding(KlinaraMetrics.screenInset)
                } else if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(zoom)
                        .gesture(
                            MagnifyGesture()
                                .onChanged { zoom = max(1, min(4, $0.magnification)) }
                                .onEnded { _ in
                                    if zoom < 1.1 { withAnimation { zoom = 1 } }
                                }
                        )
                } else {
                    ProgressView().tint(KlinaraColor.surfaceRaised)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Kapat") { dismiss() }
                }
                if canDelete {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(role: .destructive) { deleting = true } label: {
                            Image(systemName: "trash")
                        }
                        .accessibilityLabel("Fotoğrafı sil")
                    }
                }
            }
            .task { await load() }
            .confirmationDialog(
                "Fotoğraf silinsin mi?",
                isPresented: $deleting,
                titleVisibility: .visible
            ) {
                Button("Sil", role: .destructive) { Task { await delete() } }
                Button("Vazgeç", role: .cancel) {}
            } message: {
                Text(
                    "Fotoğraf karttan kalkar. Saklama yükümlülükleri gereği dosya "
                        + "depolamadan hemen silinmez."
                )
            }
        }
        .tint(KlinaraColor.sage)
    }

    private var title: String {
        let date = file.takenAt ?? file.createdAt
        guard file.position != .other else { return clock.formatDate(date) }
        return "\(file.position.turkishName) · \(clock.formatDate(date))"
    }

    private func load() async {
        error = nil
        do {
            image = try await thumbnails.original(for: file)
        } catch {
            self.error = error as? APIError ?? .network
        }
    }

    private func delete() async {
        error = nil
        do {
            try await record.deleteFile(id: file.id)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
