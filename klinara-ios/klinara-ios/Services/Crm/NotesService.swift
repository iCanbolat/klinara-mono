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
    /// **`If-Match` yok**: eşzamanlı düzenlemede son yazan kazanıyor. Revizyon
    /// geçmişi veri kaybını engelliyor ama bir kilit değil (Ek G devreden madde).
    func update(noteId: String, _ input: UpdateNoteInput) async throws -> CustomerNote

    /// `DELETE /notes/:id` — arşivler (soft delete).
    func delete(noteId: String) async throws

    /// `GET /notes/:id/revisions` — düzenlemeden ÖNCEKİ metinler, yeniden eskiye.
    func revisions(noteId: String) async throws -> [CustomerNoteRevision]

    /// `GET /customers/:id/timeline` — randevu + not, tek akış, cursor'lu.
    func timeline(customerId: String, cursor: String?, limit: Int?) async throws
        -> Page<TimelineEntry>
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

    func update(noteId: String, _ input: UpdateNoteInput) async throws -> CustomerNote {
        try await client.send(APIRequest.patch("notes/\(noteId)", body: input))
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
        cursor: String?,
        limit: Int?
    ) async throws -> Page<TimelineEntry> {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        return try await client.send(
            APIRequest.get("customers/\(customerId)/timeline", query: query)
        )
    }
}
