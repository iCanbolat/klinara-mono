import SwiftUI

/// Tek bir müşteri kartının verisi: zaman çizelgesi, notlar ve dosyalar.
///
/// ``CustomerStore`` oturum ömürlü ve **liste** kapsamlı; kart verisini oraya
/// koymak, açılmış her müşterinin notunu ve fotoğrafını oturum boyunca bellekte
/// tutmak olurdu. Bu store kartla birlikte doğar ve kartla birlikte ölür —
/// `CustomerDetailView` onu `.task(id:)` ile kuruyor.
@MainActor
@Observable
final class CustomerRecordStore {

    private let notesService: any NotesService
    private let filesService: any FilesService
    let customerId: String

    /// Zaman çizelgesi **birikimli**: `loadMore` sayfaları sona ekliyor.
    private(set) var timeline: LoadState<[TimelineEntry]> = .loading
    private(set) var timelineCursor: String?
    private(set) var isLoadingMore = false

    private(set) var notes: LoadState<[CustomerNote]> = .loading
    private(set) var files: LoadState<[CustomerFile]> = .loading
    private(set) var groups: LoadState<[CustomerFileGroup]> = .loading
    private(set) var isSaving = false

    /// Klinik veriyi (fotoğraf, işlem/iç not) okuyabiliyor mu. Sunucu bunları
    /// zaten sorgudan düşürüyor; bayrak "hiç yok" ile "göremiyorsun" ayrımını
    /// kullanıcıya doğru anlatmak için.
    let canReadMedical: Bool
    let canWriteMedical: Bool

    init(
        customerId: String,
        notes: any NotesService,
        files: any FilesService,
        canReadMedical: Bool,
        canWriteMedical: Bool
    ) {
        self.customerId = customerId
        self.notesService = notes
        self.filesService = files
        self.canReadMedical = canReadMedical
        self.canWriteMedical = canWriteMedical
    }

    var timelineEntries: [TimelineEntry] { timeline.value ?? [] }
    var canLoadMore: Bool { timelineCursor != nil }

    // MARK: Zaman çizelgesi

    func loadTimeline() async {
        timeline = .loading
        timelineCursor = nil
        do {
            let page = try await notesService.timeline(
                customerId: customerId,
                cursor: nil,
                limit: nil
            )
            timeline = .loaded(page.data)
            timelineCursor = page.pageInfo.nextCursor
        } catch {
            timeline = .failed(error as? APIError ?? .network)
        }
    }

    func loadMoreTimeline() async {
        guard let cursor = timelineCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await notesService.timeline(
                customerId: customerId,
                cursor: cursor,
                limit: nil
            )
            timeline = .loaded(timelineEntries + page.data)
            timelineCursor = page.pageInfo.nextCursor
        } catch {
            // Elde olan sayfalar duruyor; cursor korunuyor ki tekrar denenebilsin.
            timelineCursor = cursor
        }
    }

    // MARK: Notlar

    func loadNotes() async {
        notes = .loading
        do {
            notes = .loaded(try await notesService.notes(customerId: customerId))
        } catch {
            notes = .failed(error as? APIError ?? .network)
        }
    }

    func createNote(_ input: CreateNoteInput) async throws {
        try await mutating {
            _ = try await notesService.create(customerId: customerId, input)
            // Not zaman çizelgesine de düşüyor; ikisini de tazelemek yerine
            // tek kaynaktan yeniden okumak tutarsız iki liste bırakmıyor.
            await refreshNotesAndTimeline()
        }
    }

    func updateNote(id: String, _ input: UpdateNoteInput) async throws {
        try await mutating {
            _ = try await notesService.update(noteId: id, input)
            await refreshNotesAndTimeline()
        }
    }

    func deleteNote(id: String) async throws {
        try await mutating {
            try await notesService.delete(noteId: id)
            await refreshNotesAndTimeline()
        }
    }

    func revisions(noteId: String) async throws -> [CustomerNoteRevision] {
        try await notesService.revisions(noteId: noteId)
    }

    /// Bir notun güncel hâli — düzenleme sayfası açılırken.
    func note(id: String) -> CustomerNote? {
        (notes.value ?? []).first { $0.id == id }
    }

    // MARK: Dosyalar

    /// Belgeler `customer:read` ile, klinik fotoğraflar `customer.medical:read`
    /// ile görünüyor; ayrımı sunucu yapıyor, burada iki liste birden isteniyor.
    func loadFiles() async {
        files = .loading
        groups = .loading
        do {
            files = .loaded(try await filesService.files(customerId: customerId))
        } catch {
            files = .failed(error as? APIError ?? .network)
        }
        do {
            groups = .loaded(try await filesService.groups(customerId: customerId))
        } catch {
            groups = .failed(error as? APIError ?? .network)
        }
    }

    func deleteFile(id: String) async throws {
        try await mutating {
            try await filesService.delete(fileId: id)
            await loadFiles()
        }
    }

    func createGroup(_ input: CreateFileGroupInput) async throws -> CustomerFileGroup {
        try await mutating {
            let group = try await filesService.createGroup(customerId: customerId, input)
            await loadFiles()
            return group
        }
    }

    /// Yükleme tamamlandıktan sonra. Küçük görsel kuyruk işiyle üretiliyor ve
    /// birkaç saniye sürüyor; liste **bir kez** gecikmeli tazeleniyor —
    /// sonsuz yoklama yapılmıyor.
    func afterUpload() async {
        await loadFiles()
        Task {
            try? await Task.sleep(for: .seconds(4))
            await loadFiles()
        }
    }

    // MARK: Yardımcılar

    private func refreshNotesAndTimeline() async {
        async let notesReload: Void = loadNotes()
        async let timelineReload: Void = loadTimeline()
        _ = await (notesReload, timelineReload)
    }

    private func mutating<T>(_ work: () async throws -> T) async throws -> T {
        isSaving = true
        defer { isSaving = false }
        return try await work()
    }
}
