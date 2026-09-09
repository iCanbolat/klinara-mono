import QuickLook
import SwiftUI
import UniformTypeIdentifiers

/// Yüklenmiş bir belgeyi (PDF ya da görsel) açar.
///
/// Belge içeriği depolamada duruyor ve yalnız kısa ömürlü imzalı adresle
/// okunabiliyor; QuickLook ise **dosya yolu** istiyor. Bu yüzden içerik önce
/// geçici dizine yazılıyor, ekran kapanınca siliniyor — kum havuzunda kalıcı
/// bir kopya bırakmak, silinmiş bir belgenin cihazda yaşamaya devam etmesi
/// demekti.
///
/// Her açılış `download-url?variant=original` çağırıyor ve KVKK erişim
/// kaydına **`download`** olarak düşüyor; ``PhotoDetailView`` ile aynı kural.
struct DocumentPreviewView: View {

    let session: AppSession
    let file: CustomerFile

    @Environment(\.dismiss) private var dismiss
    @State private var localURL: URL?
    @State private var error: APIError?

    var body: some View {
        NavigationStack {
            Group {
                if let error {
                    ErrorBanner(error: error, onRetry: { Task { await load() } })
                        .padding(KlinaraMetrics.screenInset)
                } else if let localURL {
                    QuickLookView(url: localURL)
                        .ignoresSafeArea(edges: .bottom)
                } else {
                    ProgressView().tint(KlinaraColor.sage)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(KlinaraColor.surface)
            .navigationTitle(FileContentType.turkishName(of: file.mimeType))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Kapat") { dismiss() }
                }
            }
            .task { await load() }
            .onDisappear(perform: discard)
        }
        .tint(KlinaraColor.sage)
    }

    private func load() async {
        error = nil
        do {
            let link = try await session.services.files.downloadURL(
                fileId: file.id,
                variant: .original
            )
            guard let remote = URL(string: link.url) else {
                throw APIError.malformedResponse("İndirme adresi çözülemedi")
            }
            let (data, _) = try await URLSession.shared.data(from: remote)

            // Uzantı ŞART: QuickLook tipi dosya adından çıkarıyor, uzantısız
            // bir dosyayı ham metin gibi açardı.
            let ext = UTType(mimeType: file.mimeType)?.preferredFilenameExtension ?? "dat"
            let target = FileManager.default.temporaryDirectory
                .appendingPathComponent("\(file.id).\(ext)")
            try data.write(to: target, options: .atomic)
            localURL = target
        } catch {
            self.error = error as? APIError ?? .network
        }
    }

    private func discard() {
        guard let localURL else { return }
        try? FileManager.default.removeItem(at: localURL)
    }
}

/// `QLPreviewController` sarmalayıcısı. Tek öğe gösteriyor; belge listesi
/// gezinmesi burada bir işe yaramaz, ekran zaten tek dosya için açılıyor.
private struct QuickLookView: UIViewControllerRepresentable {

    let url: URL

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        context.coordinator.url = url
        controller.reloadData()
    }

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {

        var url: URL

        init(url: URL) { self.url = url }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

        func previewController(
            _ controller: QLPreviewController,
            previewItemAt index: Int
        ) -> QLPreviewItem {
            url as NSURL
        }
    }
}
