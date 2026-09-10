import Foundation

/// Not ve zaman çizelgesi uçları — `apps/api/src/modules/crm/notes.controller.ts`.
///
/// Görünürlük **sunucuda** daraltılıyor: klinik notlar `customer.medical:read`
/// izni olmayana sorgudan hiç dönmüyor ve detayda `404` veriyor, `403` değil.
/// İstemcideki izin kontrolleri kullanıcıya basınca hata alacağı düğmeyi hiç
/// göstermemek içindir; son savunma hattı sunucudur.
protocol NotesService: Sendable {

    /// `GET /customers/:id/notes`
    func notes(customerId: String) async throws -> [CustomerNote]

    /// `POST /customers/:id/notes`
    func create(customerId: String, _ input: CreateNoteInput) async throws -> CustomerNote

    /// `PATCH /notes/:id` — metin değişirse eski sürüm trigger'la saklanır.
    ///
    /// `version` **zorunlu**: sunucu `If-Match` istiyor. Başlıksız istek `428`,
    /// bayat sürüm `409 VERSION_CONFLICT` alır. Değer notun okunduğu andaki
    /// sürümdür — yanıt başlığını okumaya gerek yok, gövdedeki `version` yeter.
    ///
    /// ⚠️ Sürümü YALNIZ METİN değişimi artırır; tür ya da görünürlük değişimi
    /// sürümü olduğu yerde bırakır ve elde tutulan değer geçerli kalır.
    func update(noteId: String, version: Int, _ input: UpdateNoteInput) async throws -> CustomerNote

    /// `DELETE /notes/:id` — arşivler (soft delete).
    func delete(noteId: String) async throws

    /// `GET /notes/:id/revisions` — düzenlemeden ÖNCEKİ metinler, yeniden eskiye.
    func revisions(noteId: String) async throws -> [CustomerNoteRevision]

    /// `GET /customers/:id/timeline` — randevu + not, tek akış, cursor'lu.
    ///
    /// Filtre **sunucuda**: yüklenmiş sayfalar üzerinde süzmek, "son 3 ay"
    /// diyen kullanıcıya elindeki ilk 50 kaydın içindeki son 3 ayı gösterirdi.
    func timeline(
        customerId: String,
        query: TimelineQuery,
        cursor: String?,
        limit: Int?
    ) async throws -> Page<TimelineEntry>
}

struct LiveNotesService: NotesService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func notes(customerId: String) async throws -> [CustomerNote] {
        let response: ListEnvelope<CustomerNote> = try await client.send(
            APIRequest.get("customers/\(customerId)/notes")
        )
        return response.data
    }

    func create(customerId: String, _ input: CreateNoteInput) async throws -> CustomerNote {
        try await client.send(APIRequest.post("customers/\(customerId)/notes", body: input))
    }

    func update(noteId: String, version: Int, _ input: UpdateNoteInput) async throws -> CustomerNote {
        try await client.send(
            APIRequest.patch("notes/\(noteId)", body: input, ifMatch: weakETag(version))
        )
    }

    func delete(noteId: String) async throws {
        try await client.send(APIRequest.delete("notes/\(noteId)"))
    }

    func revisions(noteId: String) async throws -> [CustomerNoteRevision] {
        let response: ListEnvelope<CustomerNoteRevision> = try await client.send(
            APIRequest.get("notes/\(noteId)/revisions")
        )
        return response.data
    }

    func timeline(
        customerId: String,
        query: TimelineQuery,
        cursor: String?,
        limit: Int?
    ) async throws -> Page<TimelineEntry> {
        var items: [URLQueryItem] = []
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        if !query.kinds.isEmpty {
            // Sunucu virgülle ayrılmış tek değer bekliyor; sırayı sabitlemek
            // isteği önbelleklenebilir ve loglarda okunabilir kılıyor.
            let kinds = TimelineKind.allCases
                .filter(query.kinds.contains)
                .map(\.rawValue)
                .joined(separator: ",")
            items.append(URLQueryItem(name: "kinds", value: kinds))
        }
        // Sınırlar UTC yazılıyor: `Date` zaten mutlak bir an ve sunucu
        // offset'li her ISO 8601 değerini kabul ediyor. Şube saatine çevirmek
        // yalnız yazma uçlarında anlamlı (denetim kaydı okunabilirliği).
        if let from = query.from {
            items.append(URLQueryItem(name: "from", value: KlinaraCoding.timestamp(from)))
        }
        if let to = query.to {
            items.append(URLQueryItem(name: "to", value: KlinaraCoding.timestamp(to)))
        }
        return try await client.send(
            APIRequest.get("customers/\(customerId)/timeline", query: items)
        )
    }
}
