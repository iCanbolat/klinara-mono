import SwiftUI

/// Müşteri kartının "Fotoğraflar ve belgeler" bölümü.
///
/// Fotoğraf ve belge **ayrı** çiziliyor: fotoğraf sağlık verisidir (KVKK m.6),
/// kimlik fotokopisi değildir. Sunucu ayrımı `customer_files.kind` üzerinden
/// yapıyor ve klinik fotoğrafları izinsiz kullanıcıya hiç döndürmüyor.
struct CustomerFilesSection: View {

    let session: AppSession
    let record: CustomerRecordStore
    let thumbnails: ThumbnailCache

    @State private var uploading: FileKind?
    @State private var opened: CustomerFile?

    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.customerWrite) }
    private var canWritePhotos: Bool { session.can(Permissions.customerMedicalWrite) }

    var body: some View {
        switch record.files {
        case .loading:
            KlinaraCard(title: "Fotoğraflar ve belgeler") {
                ProgressView()
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity)
                    .padding(KlinaraMetrics.lg)
            }

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await record.loadFiles() } })

        case .loaded(let files):
            if record.canReadMedical {
                photosCard(files.filter { $0.kind == .photo })
            }
            documentsCard(files.filter { $0.kind == .document })
        }
    }

    // MARK: Fotoğraflar

    private func photosCard(_ photos: [CustomerFile]) -> some View {
        KlinaraCard(
            title: "Fotoğraflar",
            footnote: "Klinik fotoğrafları özel nitelikli veridir; her "
                + "görüntüleme kayda geçer."
        ) {
            if photos.isEmpty {
                KlinaraRow(label: "Fotoğraf yok")
            } else {
                PhotoGridView(
                    photos: photos,
                    thumbnails: thumbnails,
                    onTap: { opened = $0 }
                )
                .padding(KlinaraMetrics.md)
            }

            if canWritePhotos {
                KlinaraDivider()
                KlinaraButton(title: "Fotoğraf ekle", kind: .tertiary, icon: "camera") {
                    uploading = .photo
                }
                .padding(KlinaraMetrics.md)
            }
        }
        .sheet(item: $uploading) { kind in
            FileUploadSheet(session: session, record: record, kind: kind)
        }
        .sheet(item: $opened) { file in
            PhotoDetailView(
                session: session,
                record: record,
                thumbnails: thumbnails,
                file: file
            )
        }
    }

    // MARK: Belgeler

    private func documentsCard(_ documents: [CustomerFile]) -> some View {
        KlinaraCard(title: "Belgeler") {
            if documents.isEmpty {
                KlinaraRow(label: "Belge yok")
            } else {
                ForEach(Array(documents.enumerated()), id: \.element.id) { index, file in
                    if index > 0 { KlinaraDivider() }
                    KlinaraRow(
                        label: file.mimeType == "application/pdf" ? "PDF belge" : "Belge",
                        detail: "\(ByteSize.format(file.sizeBytes)) · "
                            + clock.formatDate(file.createdAt)
                    ) {
                        Image(systemName: "doc")
                            .font(.system(size: 13))
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                    }
                }
            }

            if canWrite {
                KlinaraDivider()
                KlinaraButton(title: "Belge ekle", kind: .tertiary, icon: "doc.badge.plus") {
                    uploading = .document
                }
                .padding(KlinaraMetrics.md)
            }
        }
    }
}

/// Bayt → "2,4 MB".
enum ByteSize {
    static func format(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        formatter.allowedUnits = [.useKB, .useMB]
        return formatter.string(fromByteCount: Int64(bytes))
    }
}

// MARK: - Izgara

/// Küçük görsel ızgarası.
///
/// Küçük görsel kuyruk işiyle üretiliyor ve birkaç saniye sürüyor; hazır
/// olmayan hücre yer tutucu gösterir. ``CustomerRecordStore/afterUpload()``
/// listeyi **bir kez** gecikmeli tazeliyor — sonsuz yoklama yok.
struct PhotoGridView: View {

    let photos: [CustomerFile]
    let thumbnails: ThumbnailCache
    let onTap: (CustomerFile) -> Void

    private let columns = [GridItem(.adaptive(minimum: 92), spacing: KlinaraMetrics.sm)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: KlinaraMetrics.sm) {
            ForEach(photos) { photo in
                Button { onTap(photo) } label: {
                    PhotoThumbnail(file: photo, thumbnails: thumbnails)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct PhotoThumbnail: View {

    let file: CustomerFile
    let thumbnails: ThumbnailCache

    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                KlinaraColor.border.opacity(0.35)
                Image(systemName: file.hasThumbnail ? "photo" : "clock")
                    .font(.system(size: 18, weight: .light))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }

            if file.position != .other {
                VStack {
                    Spacer()
                    HStack {
                        KlinaraBadge(text: file.position.turkishName, tone: .neutral)
                            .padding(4)
                        Spacer()
                    }
                }
            }
        }
        .frame(height: 92)
        .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
        .task(id: file.id) { image = await thumbnails.thumbnail(for: file) }
        .accessibilityLabel(file.position == .other ? "Fotoğraf" : file.position.turkishName)
    }
}
