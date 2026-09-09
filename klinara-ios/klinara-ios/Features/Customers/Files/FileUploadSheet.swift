import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Fotoğraf / belge yükleme sayfası.
///
/// Akış üç adım (`presign` → PUT → `confirm`) ve ilerleme kullanıcıya
/// gösteriliyor: dosya içeriği API sürecinden geçmediği için "yükleniyor"
/// aşaması gerçekten uzun sürebilir ve sessiz bir bekleme, kopmuş bir yükleme
/// gibi görünür.
struct FileUploadSheet: View {

    let session: AppSession
    let record: CustomerRecordStore
    let kind: FileKind

    /// Öncesi/sonrası kartındaki boş yuvadan gelindiğinde dolu.
    ///
    /// Kullanıcı grubu ve konumu yuvaya dokunarak **zaten seçti**; aynı şeyi
    /// bir de sayfada sormak, iki seçimin ayrışmasına ve fotoğrafın yanlış
    /// yuvaya düşmesine açık kapı bırakırdı.
    private let presetGroupId: String?
    private let presetPosition: FilePosition?

    @Environment(\.dismiss) private var dismiss

    @State private var pickerItem: PhotosPickerItem?
    @State private var payload: FileUploader.Payload?
    @State private var preview: UIImage?
    /// Seçilen dosyanın adı — yalnız belgede dolu. Fotoğrafta önizleme zaten
    /// ne seçildiğini gösteriyor, belgede gösterecek başka bir şey yok.
    @State private var pickedName: String?
    @State private var showsFileImporter = false
    @State private var position: FilePosition = .other
    @State private var groupId: String?
    @State private var takenAt = Date()
    @State private var hasTakenAt = false
    @State private var showsCamera = false
    @State private var step: FileUploader.Step?
    @State private var error: APIError?

    init(
        session: AppSession,
        record: CustomerRecordStore,
        kind: FileKind,
        presetGroupId: String? = nil,
        presetPosition: FilePosition? = nil
    ) {
        self.session = session
        self.record = record
        self.kind = kind
        self.presetGroupId = presetGroupId
        self.presetPosition = presetPosition
        _position = State(initialValue: presetPosition ?? .other)
        _groupId = State(initialValue: presetGroupId)
    }

    private var uploader: FileUploader { FileUploader(service: session.services.files) }
    private var isUploading: Bool { step != nil }
    private var hasPreset: Bool { presetGroupId != nil || presetPosition != nil }

    var body: some View {
        KlinaraFormScaffold(
            title: kind == .photo ? "Fotoğraf ekle" : "Belge ekle",
            saveTitle: "Yükle",
            canSave: payload != nil,
            isDirty: payload != nil,
            isReadOnly: false,
            isSaving: isUploading,
            error: error,
            onSave: upload
        ) {
            sourceSection
            if kind == .photo {
                photoDetailsSection
            }
            if let step {
                progressSection(step)
            }
        }
        .onChange(of: pickerItem) { _, item in Task { await load(item) } }
        .fileImporter(
            isPresented: $showsFileImporter,
            allowedContentTypes: FileContentType.allowedUTTypes,
            allowsMultipleSelection: false,
            onCompletion: load
        )
        .fullScreenCover(isPresented: $showsCamera) {
            CameraPicker { image in
                apply(image)
            }
            .ignoresSafeArea()
        }
    }

    // MARK: Kaynak

    @ViewBuilder
    private var sourceSection: some View {
        KlinaraFormSection(title: "Kaynak", footnote: sourceFootnote) {
            if let preview {
                Image(uiImage: preview)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 220)
                    .clipShape(.rect(cornerRadius: KlinaraMetrics.controlRadius))
                    .padding(KlinaraMetrics.md)
                KlinaraDivider()
            }

            if let payload {
                KlinaraRow(
                    label: pickedName ?? "Seçilen dosya",
                    value: ByteSize.format(payload.data.count),
                    detail: FileContentType.turkishName(of: payload.contentType)
                )
                KlinaraDivider()
            }

            // Belgede önce "Dosyalar": kimlik fotokopisi ve onam çıktısı
            // galeride değil, iCloud Drive'da ya da e-posta ekinde duruyor.
            if kind == .document {
                Button { showsFileImporter = true } label: {
                    KlinaraRow(label: "Dosyalardan seç") {
                        Image(systemName: "folder")
                            .foregroundStyle(KlinaraColor.sageDeep)
                    }
                }
                .buttonStyle(.plain)
                .disabled(isUploading)
                KlinaraDivider()
            }

            PhotosPicker(selection: $pickerItem, matching: .images) {
                KlinaraRow(label: "Galeriden seç") {
                    Image(systemName: "photo.on.rectangle")
                        .foregroundStyle(KlinaraColor.sageDeep)
                }
            }
            .disabled(isUploading)

            if kind == .photo, UIImagePickerController.isSourceTypeAvailable(.camera) {
                KlinaraDivider()
                Button { showsCamera = true } label: {
                    KlinaraRow(label: "Kamerayla çek") {
                        Image(systemName: "camera")
                            .foregroundStyle(KlinaraColor.sageDeep)
                    }
                }
                .buttonStyle(.plain)
                .disabled(isUploading)
            }
        }
    }

    /// Belge yeniden kodlanmıyor, fotoğraf küçültülüyor: iki farklı vaat.
    private var sourceFootnote: String {
        switch kind {
        case .photo:
            return "Fotoğraf uzun kenarı 2048 piksele indirilir ve "
                + "\(ByteSize.format(FileContentType.maxBytes)) sınırının altına küçültülür."
        case .document:
            return "PDF ya da görsel (JPEG, PNG, WebP, HEIC), en çok "
                + "\(ByteSize.format(FileContentType.maxBytes)). Belge olduğu gibi yüklenir."
        }
    }

    // MARK: Fotoğraf ayrıntıları

    private var photoDetailsSection: some View {
        KlinaraFormSection(
            title: "Eşleme",
            footnote: hasPreset
                ? "Fotoğraf bu grubun \(position.turkishName.lowercased()) yuvasına yüklenir."
                : "Öncesi/sonrası karşılaştırması için fotoğrafı bir gruba bağlayın."
        ) {
            if hasPreset {
                KlinaraRow(label: "Grup", value: presetGroupTitle)
                KlinaraDivider()
                KlinaraRow(label: "Konum", value: position.turkishName)
            } else {
                Picker("Konum", selection: $position) {
                    ForEach(FilePosition.allCases) { value in
                        Text(value.turkishName).tag(value)
                    }
                }
                .pickerStyle(.segmented)
                .padding(KlinaraMetrics.md)
                .disabled(isUploading)

                KlinaraDivider()

                Picker("Grup", selection: $groupId) {
                    Text("Grupsuz").tag(String?.none)
                    ForEach(record.groups.value ?? []) { group in
                        Text(group.title).tag(String?.some(group.id))
                    }
                }
                .pickerStyle(.menu)
                .tint(KlinaraColor.sageDeep)
                .klinaraText(.bodyM)
                .padding(KlinaraMetrics.md)
                .disabled(isUploading)
            }

            KlinaraDivider()

            KlinaraToggleRow(
                label: "Çekim tarihi",
                detail: "Galeriden gelen eski bir fotoğrafta yükleme tarihiyle karışmasın.",
                isOn: $hasTakenAt,
                isEnabled: !isUploading
            )

            if hasTakenAt {
                KlinaraDivider()
                DatePicker("Çekim tarihi", selection: $takenAt, in: ...Date())
                    .environment(\.timeZone, session.clock.timeZone)
                    .klinaraText(.bodyM)
                    .padding(KlinaraMetrics.md)
                    .disabled(isUploading)
            }
        }
    }

    private var presetGroupTitle: String {
        guard let presetGroupId,
              let group = record.groups.value?.first(where: { $0.id == presetGroupId })
        else { return "Grupsuz" }
        return group.title
    }

    private func progressSection(_ step: FileUploader.Step) -> some View {
        KlinaraFormSection(title: "Yükleniyor") {
            KlinaraRow(label: description(of: step)) {
                ProgressView().tint(KlinaraColor.sage)
            }
        }
    }

    /// Adımların ayrı ayrı adlandırılması gerekiyor: "yükleme başarısız"
    /// kullanıcıya ne yapacağını söylemez, "adres alınamadı" söyler.
    private func description(of step: FileUploader.Step) -> String {
        switch step {
        case .preparing: return "Dosya hazırlanıyor…"
        case .requestingURL: return "Yükleme adresi alınıyor…"
        case .uploading: return "Dosya gönderiliyor…"
        case .confirming: return "Kayıt açılıyor…"
        }
    }

    // MARK: Eylemler

    private func load(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        error = nil
        step = .preparing
        defer { step = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            error = .malformedResponse("Seçilen dosya okunamadı")
            return
        }
        if kind == .photo, let image = UIImage(data: data) {
            apply(image)
        } else {
            // Galeriden gelen bir belge de PDF DEĞİL: tipi baytlardan okuyoruz.
            pickedName = nil
            apply(documentData: data, filenameExtension: nil)
        }
    }

    /// `fileImporter` sonucu. Seçilen dosya uygulamanın kum havuzunun dışında;
    /// güvenlik kapsamı açılmadan `Data(contentsOf:)` izin hatası verir.
    private func load(_ result: Result<[URL], Error>) {
        error = nil
        guard case .success(let urls) = result else {
            error = .malformedResponse("Dosya seçilemedi")
            return
        }
        guard let url = urls.first else { return }

        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        guard let data = try? Data(contentsOf: url) else {
            error = .malformedResponse("Seçilen dosya okunamadı")
            return
        }
        pickedName = url.lastPathComponent
        apply(documentData: data, filenameExtension: url.pathExtension)
    }

    /// Belge gövdesini yüklenebilir hâle getirir.
    ///
    /// Tip ve boyut hataları AYRI: "desteklenmiyor" ile "çok büyük" kullanıcıya
    /// bambaşka şeyler yaptırır — birinde dosyayı değiştirir, diğerinde küçültür.
    private func apply(documentData data: Data, filenameExtension: String?) {
        guard let contentType = FileContentType.detect(
            data: data,
            filenameExtension: filenameExtension
        ) else {
            payload = nil
            preview = nil
            error = .problem(ProblemDetails(
                code: .validationFailed,
                title: "Bu dosya türü desteklenmiyor",
                detail: "PDF ya da JPEG, PNG, WebP, HEIC görsel yükleyebilirsiniz.",
                status: 400
            ))
            return
        }

        payload = FileUploader.prepare(documentData: data, contentType: contentType)
        // Görsel bir belgede önizleme, yanlış dosyayı yüklemenin önündeki
        // en ucuz engel.
        preview = UIImage(data: data)

        if payload == nil {
            error = .problem(ProblemDetails(
                code: .validationFailed,
                title: "Dosya çok büyük",
                detail: "En çok \(ByteSize.format(FileContentType.maxBytes)) yükleyebilirsiniz.",
                status: 400
            ))
        }
    }

    private func apply(_ image: UIImage) {
        preview = image
        payload = FileUploader.prepare(image: image)
        if payload == nil {
            error = .problem(ProblemDetails(
                code: .validationFailed,
                title: "Fotoğraf küçültülemedi",
                detail: "Dosya boyut sınırının altına indirilemedi.",
                status: 400
            ))
        }
    }

    private func upload() async {
        guard let payload else { return }
        error = nil
        do {
            _ = try await uploader.upload(
                payload: payload,
                customerId: record.customerId,
                kind: kind,
                position: kind == .photo ? position : .other,
                groupId: kind == .photo ? groupId : nil,
                takenAt: hasTakenAt ? takenAt : nil,
                onStep: { next in Task { @MainActor in step = next } }
            )
            await record.afterUpload()
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
        step = nil
    }
}

// MARK: - Kamera

/// `UIImagePickerController` sarmalayıcısı.
///
/// SwiftUI'nin ``PhotosPicker``'ı yalnız kütüphaneye bakıyor; klinikte
/// öncesi/sonrası fotoğrafı çoğunlukla o anda çekiliyor ve galeriye kaydetmeden
/// doğrudan karta girmesi gerekiyor.
struct CameraPicker: UIViewControllerRepresentable {

    let onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let controller = UIImagePickerController()
        controller.sourceType = .camera
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onCapture: onCapture, onFinish: { dismiss() })
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate,
        UINavigationControllerDelegate {

        private let onCapture: (UIImage) -> Void
        private let onFinish: () -> Void

        init(onCapture: @escaping (UIImage) -> Void, onFinish: @escaping () -> Void) {
            self.onCapture = onCapture
            self.onFinish = onFinish
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage { onCapture(image) }
            onFinish()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onFinish()
        }
    }
}
