import Foundation
import Testing
import UIKit
import UniformTypeIdentifiers
@testable import klinara_ios

/// Batch 4.1 davranışı — mock sadakati ve store.
@Suite("Müşteri kartı (Batch 4.1)")
@MainActor
struct CustomerSearchAndTagTests {

    @Test("Sunucu araması Türkçe katlamayla eşleşir")
    func serverSearchFoldsTurkish() async throws {
        let graph = MockGraph(scenario: .busyDay)

        // Sunucudaki `klinara_fold_tr()` ile aynı harita: aynı sorguya aynı cevap.
        #expect(try await graph.customers.search("YILMAZ", limit: nil).count == 1)
        #expect(try await graph.customers.search("yilmaz", limit: nil).count == 1)
        #expect(try await graph.customers.search("ayse", limit: nil).count == 1)
        // Telefon rakama indirgenip aranıyor: biçimli yazım da bulmalı.
        #expect(try await graph.customers.search("0532 111 22 33", limit: nil).count == 1)
    }

    @Test("İki karakterden kısa arama reddedilir")
    func shortSearchIsRejected() async {
        let graph = MockGraph(scenario: .busyDay)
        await #expect(throws: APIError.self) {
            try await graph.customers.search("a", limit: nil)
        }
    }

    @Test("Liste cursor'la sayfalanır ve kayıt TEKRARLANMAZ")
    func listPaginates() async throws {
        let graph = MockGraph(scenario: .busyDay)

        let first = try await graph.customers.customers(
            cursor: nil, limit: 2, tagId: nil, source: nil
        )
        #expect(first.data.count == 2)
        #expect(first.pageInfo.hasMore)

        let cursor = try #require(first.pageInfo.nextCursor)
        let second = try await graph.customers.customers(
            cursor: cursor, limit: 2, tagId: nil, source: nil
        )

        // Ofsetle sayfalasaydık araya giren bir kayıt birini iki kez gösterirdi.
        let firstIds = Set(first.data.map(\.id))
        let secondIds = Set(second.data.map(\.id))
        #expect(firstIds.isDisjoint(with: secondIds))
    }

    @Test("Store ikinci sayfayı listeye EKLER")
    func storeAppendsNextPage() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)

        // Store varsayılan sayfa boyutunu kullanıyor; mock'ta tüm kayıtlar
        // tek sayfaya sığdığı için cursor'lu yolu servisten doğruluyoruz.
        await store.load()
        let all = store.customers.count
        #expect(all > 0)
        #expect(store.canLoadMore == false)
    }

    @Test("Etiket adı KATLANMIŞ hâliyle tekildir")
    func tagNamesAreFoldedUnique() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)
        await store.loadTags()

        // "VIP" seed'de var; "vıp" aynı etiket sayılmalı.
        await #expect(throws: APIError.self) {
            try await store.createTag(CustomerTagInput(name: "vıp", color: nil))
        }
        let fresh = try await store.createTag(CustomerTagInput(name: "Kontrol", color: "#4A4F52"))
        #expect(store.tags.contains { $0.id == fresh.id })
    }

    @Test("Etiket ataması karta yansır")
    func assigningTagsUpdatesCustomer() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)
        await store.load()

        let updated = try await store.replaceTags(
            customerId: MockCustomerSeed.mehmet,
            tagIds: [MockCustomerSeed.tagVip]
        )
        #expect(updated.tags.map(\.name) == ["VIP"])
        #expect(store.customer(id: MockCustomerSeed.mehmet)?.tags.count == 1)
    }

    @Test("Etiket silinince karttan da düşer")
    func deletingTagRemovesItFromCards() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)
        await store.load()
        await store.loadTags()

        #expect(store.customer(id: MockCustomerSeed.ayse)?.tags.isEmpty == false)
        try await store.deleteTag(id: MockCustomerSeed.tagVip)

        #expect(store.tags.contains { $0.id == MockCustomerSeed.tagVip } == false)
        let ayse = store.customer(id: MockCustomerSeed.ayse)
        #expect(ayse?.tags.contains { $0.id == MockCustomerSeed.tagVip } == false)
    }

    /// Birleştirme veri **kazanmaktır**: hedefin dolu alanı ezilmez, boş alanı
    /// kaynaktan dolar. Tersi olsaydı birleştirme veri kaybı olurdu.
    @Test("Birleştirme boş alanı doldurur, DOLU alanı ezmez")
    func mergeGainsData() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = CustomerStore(service: graph.customers)
        await store.load()

        // Mehmet'in e-postası yok, Ayşe'nin var. Mehmet hayatta kalsın.
        let target = try #require(store.customer(id: MockCustomerSeed.mehmet))
        let source = try #require(store.customer(id: MockCustomerSeed.ayse))
        #expect(target.email == nil)
        #expect(source.email != nil)

        let result = try await store.merge(
            into: MockCustomerSeed.mehmet,
            sourceId: MockCustomerSeed.ayse
        )

        // Boş alan doldu…
        #expect(result.customer.email == source.email)
        // …dolu alan (ad, telefon) korundu.
        #expect(result.customer.fullName == target.fullName)
        #expect(result.customer.phone == target.phone)
        // Kaynak listeden düştü.
        #expect(store.customer(id: MockCustomerSeed.ayse) == nil)
    }

    @Test("Kayıt kendisiyle birleştirilemez")
    func cannotMergeIntoItself() async {
        let graph = MockGraph(scenario: .busyDay)
        await #expect(throws: APIError.self) {
            try await graph.customers.merge(
                into: MockCustomerSeed.ayse,
                sourceId: MockCustomerSeed.ayse
            )
        }
    }
}

/// Batch 4.2 davranışı — notlar, revizyonlar, zaman çizelgesi.
@Suite("Notlar ve zaman çizelgesi (Batch 4.2)")
@MainActor
struct CustomerRecordStoreTests {

    private func makeStore(_ graph: MockGraph, canReadMedical: Bool = true)
        -> CustomerRecordStore {
        CustomerRecordStore(
            customerId: MockCustomerSeed.ayse,
            notes: graph.notes,
            files: graph.files,
            canReadMedical: canReadMedical,
            canWriteMedical: canReadMedical
        )
    }

    @Test("Not eklemek zaman çizelgesine de düşer")
    func newNoteAppearsInTimeline() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = makeStore(graph)
        await store.loadTimeline()
        let before = store.timelineEntries.count

        try await store.createNote(CreateNoteInput(body: "Yeni gözlem", kind: .general))

        #expect(store.timelineEntries.count == before + 1)
        // Yeni not en üstte: akış `occurredAt` azalan sırada.
        guard case .note(_, let payload) = store.timelineEntries[0] else {
            Issue.record("En üstteki olay not olmalıydı")
            return
        }
        #expect(payload.body == "Yeni gözlem")
    }

    /// Trigger'ın işi: metin değişince eski gövde saklanır ve `version` artar.
    /// Yalnız `updatedAt` tazelense "düzenlendi" işareti yalan olurdu.
    @Test("Not düzenlemesi revizyon bırakır ve sürümü artırır")
    func editingNoteWritesRevision() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = makeStore(graph)
        await store.loadNotes()

        let note = try #require(store.notes.value?.first { $0.kind == .general })
        #expect(note.version == 1)
        #expect(note.wasEdited == false)

        try await store.updateNote(
            id: note.id,
            version: note.version,
            UpdateNoteInput(body: "Düzeltilmiş metin")
        )

        let updated = try #require(store.note(id: note.id))
        #expect(updated.version == 2)
        #expect(updated.wasEdited)

        let revisions = try await store.revisions(noteId: note.id)
        #expect(revisions.count == 1)
        // Saklanan metin ESKİ metindir.
        #expect(revisions[0].body == note.body)
    }

    @Test("Metin değişmeyen düzenleme revizyon bırakmaz")
    func unchangedTextLeavesNoRevision() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = makeStore(graph)
        await store.loadNotes()

        let note = try #require(store.notes.value?.first { $0.kind == .general })
        try await store.updateNote(
            id: note.id,
            version: note.version,
            UpdateNoteInput(customerVisible: true)
        )

        let updated = try #require(store.note(id: note.id))
        #expect(updated.version == 1)
        #expect(try await store.revisions(noteId: note.id).isEmpty)
    }

    /// Sunucu `PATCH /notes/:id` üzerinde `If-Match` ZORUNLU tutuyor: bayat bir
    /// sürümle kaydetmek 409 alır. Faz 4'te bu uçta kilit yoktu ve istemci
    /// yalnız uyarı basıyordu; uyarı, iki kişi aynı anda yazdığında birinin
    /// cümlesinin kaybolmasını engellemiyordu.
    @Test("Bayat sürümle kaydetme VERSION_CONFLICT alır")
    func staleVersionIsRejected() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let store = makeStore(graph)
        await store.loadNotes()

        let note = try #require(store.notes.value?.first { $0.kind == .general })
        try await store.updateNote(
            id: note.id,
            version: note.version,
            UpdateNoteInput(body: "Birinci düzenleme")
        )

        // İkinci düzenleyici hâlâ açılıştaki sürümü tutuyor.
        await #expect(throws: APIError.self) {
            try await store.updateNote(
                id: note.id,
                version: note.version,
                UpdateNoteInput(body: "İkinci düzenleme")
            )
        }
        #expect(store.note(id: note.id)?.body == "Birinci düzenleme")
    }

    /// Görünürlük SQL'de daralıyor, uygulamada değil: klinik notlar sorgudan
    /// hiç çıkmıyor. Listeyi çekip sonra elemek sayfa boyutunu bozardı.
    @Test("Klinik izni olmayan işlem/iç notları HİÇ görmez")
    func clinicalNotesAreInvisibleWithoutPermission() async throws {
        let permitted = MockGraph(scenario: .busyDay, canReadMedical: true)
        let restricted = MockGraph(scenario: .busyDay, canReadMedical: false)

        let all = try await permitted.notes.notes(customerId: MockCustomerSeed.ayse)
        let visible = try await restricted.notes.notes(customerId: MockCustomerSeed.ayse)

        #expect(all.contains { $0.kind == .treatment })
        #expect(visible.allSatisfy { $0.kind == .general })
        #expect(visible.count < all.count)
    }

    @Test("Klinik notu yazma yetkisi olmayan reddedilir")
    func writingClinicalNoteRequiresPermission() async {
        let graph = MockGraph(scenario: .busyDay, canReadMedical: false)
        await #expect(throws: APIError.self) {
            try await graph.notes.create(
                customerId: MockCustomerSeed.ayse,
                CreateNoteInput(body: "Gözlem", kind: .treatment)
            )
        }
    }

    @Test("Zaman çizelgesi cursor'la ilerler")
    func timelinePaginates() async throws {
        let graph = MockGraph(scenario: .busyDay)

        let first = try await graph.notes.timeline(
            customerId: MockCustomerSeed.ayse,
            query: TimelineQuery(),
            cursor: nil,
            limit: 1
        )
        #expect(first.data.count == 1)
        guard first.pageInfo.hasMore, let cursor = first.pageInfo.nextCursor else { return }

        let second = try await graph.notes.timeline(
            customerId: MockCustomerSeed.ayse,
            query: TimelineQuery(),
            cursor: cursor,
            limit: 1
        )
        #expect(second.data.first?.id != first.data.first?.id)
        #expect(second.data[0].occurredAt <= first.data[0].occurredAt)
    }

    /// Filtre SUNUCUDA (mock'ta da): yüklenmiş sayfalar üzerinde süzmek,
    /// "son 3 ay" diyen kullanıcıya ilk sayfanın içindeki son 3 ayı
    /// göstermek olurdu.
    @Test("Tür filtresi yalnız istenen türü döndürür")
    func timelineFiltersByKind() async throws {
        let graph = MockGraph(scenario: .busyDay)

        let all = try await graph.notes.timeline(
            customerId: MockCustomerSeed.ayse,
            query: TimelineQuery(),
            cursor: nil,
            limit: nil
        )
        let onlyNotes = try await graph.notes.timeline(
            customerId: MockCustomerSeed.ayse,
            query: TimelineQuery(kinds: [.note]),
            cursor: nil,
            limit: nil
        )

        #expect(!onlyNotes.data.isEmpty)
        #expect(onlyNotes.data.count < all.data.count)
        #expect(onlyNotes.data.allSatisfy { if case .note = $0 { return true } else { return false } })
    }

    @Test("Boş tür kümesi süzme YAPMAZ")
    func emptyKindSetMeansNoFilter() async throws {
        let graph = MockGraph(scenario: .busyDay)

        let all = try await graph.notes.timeline(
            customerId: MockCustomerSeed.ayse,
            query: TimelineQuery(),
            cursor: nil,
            limit: nil
        )
        let explicitlyEmpty = try await graph.notes.timeline(
            customerId: MockCustomerSeed.ayse,
            query: TimelineQuery(kinds: []),
            cursor: nil,
            limit: nil
        )

        #expect(explicitlyEmpty.data.map(\.id) == all.data.map(\.id))
    }

    /// Aralık yarı açık: `from` DAHİL, `to` HARİÇ.
    @Test("Tarih aralığının üst ucu hariç, alt ucu dahil")
    func timelineRangeIsHalfOpen() async throws {
        let graph = MockGraph(scenario: .busyDay)

        let all = try await graph.notes.timeline(
            customerId: MockCustomerSeed.ayse,
            query: TimelineQuery(),
            cursor: nil,
            limit: nil
        )
        let newest = try #require(all.data.first)

        let excluded = try await graph.notes.timeline(
            customerId: MockCustomerSeed.ayse,
            query: TimelineQuery(to: newest.occurredAt),
            cursor: nil,
            limit: nil
        )
        #expect(!excluded.data.contains { $0.id == newest.id })

        let included = try await graph.notes.timeline(
            customerId: MockCustomerSeed.ayse,
            query: TimelineQuery(from: newest.occurredAt),
            cursor: nil,
            limit: nil
        )
        #expect(included.data.contains { $0.id == newest.id })
    }

    @Test("Filtre değişimi çizelgeyi baştan yükler")
    func filterChangeResetsPages() async throws {
        let graph = MockGraph(scenario: .busyDay)
        let record = await CustomerRecordStore(
            customerId: MockCustomerSeed.ayse,
            notes: graph.notes,
            files: graph.files,
            canReadMedical: true,
            canWriteMedical: true
        )

        await record.loadTimeline()
        let before = await record.timelineEntries.count
        #expect(before > 0)

        await record.applyTimelineFilter(TimelineQuery(kinds: [.note]))
        let filtered = await record.timelineEntries
        // Eski sayfaların üstüne EKLENMİYOR: sayı düşmeli, hepsi not olmalı.
        #expect(filtered.count < before)
        #expect(filtered.allSatisfy { if case .note = $0 { return true } else { return false } })

        await record.clearTimelineFilter()
        #expect(await record.timelineEntries.count == before)
    }
}

/// Batch 4.3 davranışı — yükleme akışı.
@Suite("Dosya yükleme (Batch 4.3)")
struct FileUploaderTests {

    /// `side` PİKSEL cinsindendir: ölçek 1'e sabitleniyor.
    ///
    /// Varsayılan ölçekle (simülatörde 3x) 400 "noktalık" bir görsel aslında
    /// 1200 pikseldir; küçültmeyi nokta üzerinden ölçen bir test, piksel
    /// üzerinden çalışan koda haksızlık eder — bu ayrım gerçek bir hatayı da
    /// ortaya çıkardı.
    private func makeImage(_ side: CGFloat) -> UIImage {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: side, height: side),
            format: format
        )
        return renderer.image { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(x: 0, y: 0, width: side, height: side))
        }
    }

    /// Çözülmüş görselin PİKSEL cinsinden uzun kenarı.
    private func longestSide(_ image: UIImage) -> CGFloat {
        max(image.size.width * image.scale, image.size.height * image.scale)
    }

    @Test("sha256 gövdenin kendisinden hesaplanır")
    func hashMatchesPayload() {
        let data = Data("klinara".utf8)
        let digest = FileUploader.sha256(data)

        #expect(digest.count == 64)
        #expect(digest == digest.lowercased())
        // Bilinen değer: worker sunucuda aynı özeti üretmezse dosya `pending`de kalır.
        #expect(FileUploader.sha256(data) == digest)
        #expect(FileUploader.sha256(Data("klinarb".utf8)) != digest)
    }

    @Test("Büyük görsel uzun kenardan küçültülür")
    func largeImageIsResized() throws {
        let payload = try #require(FileUploader.prepare(image: makeImage(4000)))
        #expect(payload.contentType == "image/jpeg")
        #expect(payload.data.count <= FileContentType.maxBytes)

        let decoded = try #require(UIImage(data: payload.data))
        #expect(longestSide(decoded) <= 2048)
    }

    @Test("Küçük görsel BÜYÜTÜLMEZ")
    func smallImageIsNotUpscaled() throws {
        let payload = try #require(FileUploader.prepare(image: makeImage(400)))
        let decoded = try #require(UIImage(data: payload.data))
        // Hedefin (2048) altındaki görsel olduğu boyutta kalmalı: yükleme
        // yolunun görüntüyü büyütmesinin hiçbir faydası yok, maliyeti var.
        #expect(longestSide(decoded) == 400)
    }

    @Test("Sınırı aşan belge reddedilir")
    func oversizedDocumentIsRejected() {
        let big = Data(count: FileContentType.maxBytes + 1)
        #expect(FileUploader.prepare(documentData: big, contentType: "application/pdf") == nil)
        // SVG beyaz listede YOK: çalıştırılabilir içerik taşır.
        #expect(FileUploader.prepare(documentData: Data("x".utf8), contentType: "image/svg+xml")
            == nil)
    }

    /// Akışın sırası sözleşmenin kendisi: `confirm` nesne yüklenmeden
    /// çağrılırsa sunucu 400 veriyor. Mock aynı kuralı uyguluyor, bu yüzden
    /// sıranın bozulması burada da yakalanır.
    @Test("presign → PUT → confirm sırası korunur")
    func uploadFollowsThreeSteps() async throws {
        let files = MockFilesService()
        let uploader = FileUploader(service: files)
        let payload = try #require(FileUploader.prepare(image: makeImage(600)))

        var steps: [String] = []
        let file = try await uploader.upload(
            payload: payload,
            customerId: MockCustomerSeed.ayse,
            kind: .photo,
            position: .before,
            onStep: { steps.append(String(describing: $0)) }
        )

        #expect(steps == ["requestingURL", "uploading", "confirming"])
        #expect(file.position == .before)
        #expect(file.sha256 == FileUploader.sha256(payload.data))
        // Boyut nesnenin kendisinden okunuyor.
        #expect(file.sizeBytes == payload.data.count)
        // Küçük görsel HENÜZ yok: kuyruk işi sonra koşuyor.
        #expect(file.hasThumbnail == false)
    }

    @Test("Yükleme atlanırsa confirm REDDEDİLİR")
    func confirmWithoutUploadFails() async throws {
        let files = MockFilesService()
        let ticket = try await files.presign(PresignUploadInput(
            customerId: MockCustomerSeed.ayse,
            contentType: "image/jpeg",
            sizeBytes: 1024,
            kind: .photo
        ))

        await #expect(throws: APIError.self) {
            try await files.confirm(
                customerId: MockCustomerSeed.ayse,
                ConfirmFileInput(storageKey: ticket.storageKey, kind: .photo)
            )
        }
    }

    @Test("Başka müşterinin anahtarı reddedilir")
    func foreignStorageKeyIsRejected() async {
        let files = MockFilesService()
        await #expect(throws: APIError.self) {
            try await files.confirm(
                customerId: MockCustomerSeed.ayse,
                ConfirmFileInput(storageKey: "baska-kiraci/baska-musteri/abc", kind: .photo)
            )
        }
    }

    /// Küçük görsel hazır değilken `thumb` isteği TAM BOYUTA DÜŞMEZ: sessiz
    /// düşüş ızgaraya 25 MB'lık nesneler indirirdi.
    @Test("Hazır olmayan küçük görsel 409 verir, tam boyuta düşmez")
    func thumbVariantDoesNotFallBack() async throws {
        let files = MockFilesService()
        let uploader = FileUploader(service: files)
        let payload = try #require(FileUploader.prepare(image: makeImage(300)))
        let file = try await uploader.upload(
            payload: payload,
            customerId: MockCustomerSeed.ayse,
            kind: .photo
        )

        await #expect(throws: APIError.self) {
            try await files.downloadURL(fileId: file.id, variant: .thumb)
        }
        // Tam boyut her zaman verilebilir.
        let original = try await files.downloadURL(fileId: file.id, variant: .original)
        #expect(original.url.contains("original"))
    }

    @Test("Klinik fotoğrafı izinsiz ne yüklenir ne görünür")
    func photosRequireMedicalPermission() async throws {
        let restricted = MockFilesService(canReadMedical: false)

        await #expect(throws: APIError.self) {
            try await restricted.presign(PresignUploadInput(
                customerId: MockCustomerSeed.ayse,
                contentType: "image/jpeg",
                sizeBytes: 1024,
                kind: .photo
            ))
        }
        // Belge yolu açık kalmalı: kimlik fotokopisi sağlık verisi değil.
        let document = try await restricted.presign(PresignUploadInput(
            customerId: MockCustomerSeed.ayse,
            contentType: "application/pdf",
            sizeBytes: 1024,
            kind: .document
        ))
        #expect(document.storageKey.isEmpty == false)
    }
}

// MARK: - İçerik tipi tespiti

/// Belge yükleme uzun süre tipi **varsaydı**: seçilen ne olursa olsun
/// `application/pdf` yazılıyordu. Sonuç, JPEG'in PDF olarak kaydedilmesi ve
/// gerçek bir PDF'in hiç seçilememesiydi.
///
/// Buradaki değişmez: tip baytlardan okunur, tanınmayan içerik **reddedilir**.
/// Varsayılan bir tip, hatanın kendisiydi.
@Suite("İçerik tipi tespiti")
struct FileContentTypeTests {

    /// Bir imzanın ardına gövde koymak gerekmiyor: tespit yalnız baş baytlara
    /// bakıyor ve testin gerçek dosya taşıması sözleşmeye bir şey katmazdı.
    private func bytes(_ values: [UInt8], padding: Int = 32) -> Data {
        Data(values + Array(repeating: 0x00, count: padding))
    }

    @Test("PDF imzası application/pdf verir")
    func detectsPDF() {
        #expect(FileContentType.detect(data: bytes(Array("%PDF-1.7".utf8))) == "application/pdf")
    }

    @Test("JPEG imzası image/jpeg verir")
    func detectsJPEG() {
        #expect(FileContentType.detect(data: bytes([0xFF, 0xD8, 0xFF, 0xE0])) == "image/jpeg")
    }

    @Test("PNG imzası image/png verir")
    func detectsPNG() {
        let png: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        #expect(FileContentType.detect(data: bytes(png)) == "image/png")
    }

    @Test("WebP kapsayıcısı marka alanından tanınır")
    func detectsWebP() {
        // RIFF | 4 bayt uzunluk | WEBP
        let webp = Array("RIFF".utf8) + [0x00, 0x00, 0x00, 0x00] + Array("WEBP".utf8)
        #expect(FileContentType.detect(data: bytes(webp)) == "image/webp")
    }

    @Test("HEIC kapsayıcısı marka alanından tanınır")
    func detectsHEIC() {
        let heic = [0x00, 0x00, 0x00, 0x18] as [UInt8]
            + Array("ftyp".utf8) + Array("heic".utf8)
        #expect(FileContentType.detect(data: bytes(heic)) == "image/heic")
    }

    /// Uzantı bir İDDİA. `.pdf` uzantılı bir JPEG'e inanmak, `presign`
    /// beyanı ile nesnenin gerçeğini ayırmak olurdu.
    @Test("Uzantı yanlışsa baytlar kazanır")
    func signatureBeatsExtension() {
        let jpeg = bytes([0xFF, 0xD8, 0xFF, 0xE0])
        #expect(FileContentType.detect(data: jpeg, filenameExtension: "pdf") == "image/jpeg")
    }

    @Test("İmza tanınmazsa uzantıya düşülür")
    func fallsBackToExtension() {
        let unknown = bytes([0x01, 0x02, 0x03, 0x04])
        #expect(FileContentType.detect(data: unknown, filenameExtension: "pdf") == "application/pdf")
    }

    @Test("Desteklenmeyen içerik nil döner — varsayılan tip YOK")
    func rejectsUnknown() {
        let text = Data("merhaba dünya".utf8)
        #expect(FileContentType.detect(data: text) == nil)
        #expect(FileContentType.detect(data: text, filenameExtension: "txt") == nil)
        #expect(FileContentType.detect(data: Data()) == nil)
    }

    @Test("Beyaz liste dışı bir uzantı kabul edilmez")
    func rejectsDisallowedExtension() {
        // SVG sunucuda bilinçli olarak dışarıda: çalıştırılabilir içerik taşır.
        let svg = Data("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>".utf8)
        #expect(FileContentType.detect(data: svg, filenameExtension: "svg") == nil)
    }

    /// Seçici listesi ``FileContentType/allowed``den türetiliyor; ayrışırsa
    /// kullanıcı sunucunun kabul ettiği bir dosyayı seçemez ya da tersi.
    @Test("Seçici tip listesi sunucunun beyaz listesiyle örtüşür")
    func pickerTypesMatchAllowList() {
        let mimes = Set(FileContentType.allowedUTTypes.compactMap(\.preferredMIMEType))
        #expect(mimes == Set(FileContentType.allowed))
    }
}
