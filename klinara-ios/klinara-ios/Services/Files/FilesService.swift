import Foundation

/// Dosya uçları — `apps/api/src/modules/files`.
///
/// Akış üç adım: `presign` → istemci imzalı adrese PUT → `confirm`.
/// `presign` veritabanına **hiçbir şey yazmaz**; yükleme yarıda kalırsa geriye
/// asılı bir "pending" satır kalmasın diye kayıt `confirm` adımında, nesnenin
/// gerçekten var olduğu doğrulandıktan sonra açılıyor.
protocol FilesService: Sendable {

    /// `POST /uploads/presign`
    func presign(_ input: PresignUploadInput) async throws -> PresignUploadResponse

    /// `POST /customers/:id/files` — yüklenen nesneyi müşteriye bağlar.
    func confirm(customerId: String, _ input: ConfirmFileInput) async throws -> CustomerFile

    /// `GET /customers/:id/files` — klinik fotoğraflar yalnız
    /// `customer.medical:read` izni olana döner.
    func files(customerId: String) async throws -> [CustomerFile]

    /// `GET /customers/:id/file-groups`
    func groups(customerId: String) async throws -> [CustomerFileGroup]

    /// `POST /customers/:id/file-groups`
    func createGroup(customerId: String, _ input: CreateFileGroupInput) async throws
        -> CustomerFileGroup

    /// `GET /files/:id/download-url` — süreli adres. **Her çağrı**
    /// `customer_record_access_log`a düşer (KVKK m.6): tam boyut `download`,
    /// küçük görsel `view` olarak.
    func downloadURL(fileId: String, variant: FileVariant) async throws -> DownloadURL

    /// `DELETE /files/:id` — arşivler. Nesne depolamadan SİLİNMEZ.
    func delete(fileId: String) async throws

    /// İmzalı adrese doğrudan yükleme. Ayrı bir metot çünkü bu istek
    /// uygulamanın sunucusuna değil nesne depolamasına gidiyor.
    func upload(to url: URL, data: Data, contentType: String) async throws
}

struct LiveFilesService: FilesService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func presign(_ input: PresignUploadInput) async throws -> PresignUploadResponse {
        try await client.send(APIRequest.post("uploads/presign", body: input))
    }

    func confirm(customerId: String, _ input: ConfirmFileInput) async throws -> CustomerFile {
        try await client.send(APIRequest.post("customers/\(customerId)/files", body: input))
    }

    func files(customerId: String) async throws -> [CustomerFile] {
        let response: ListEnvelope<CustomerFile> = try await client.send(
            APIRequest.get("customers/\(customerId)/files")
        )
        return response.data
    }

    func groups(customerId: String) async throws -> [CustomerFileGroup] {
        let response: ListEnvelope<CustomerFileGroup> = try await client.send(
            APIRequest.get("customers/\(customerId)/file-groups")
        )
        return response.data
    }

    func createGroup(
        customerId: String,
        _ input: CreateFileGroupInput
    ) async throws -> CustomerFileGroup {
        try await client.send(APIRequest.post("customers/\(customerId)/file-groups", body: input))
    }

    func downloadURL(fileId: String, variant: FileVariant) async throws -> DownloadURL {
        try await client.send(APIRequest.get(
            "files/\(fileId)/download-url",
            query: [URLQueryItem(name: "variant", value: variant.rawValue)]
        ))
    }

    func delete(fileId: String) async throws {
        try await client.send(APIRequest.delete("files/\(fileId)"))
    }

    func upload(to url: URL, data: Data, contentType: String) async throws {
        try await client.uploadToSignedURL(url, data: data, contentType: contentType)
    }
}
