import Foundation

nonisolated enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case put = "PUT"
    case delete = "DELETE"
}

/// Tek bir API çağrısının tarifi.
///
/// Servisler `URLRequest` kurmaz; yolu, gövdeyi ve kapsamı burada tarif eder,
/// başlıkları ve oturum yönetimini ``APIClient`` üstlenir. Bir başlığın tek bir
/// uçta unutulması bu sayede mümkün değil.
nonisolated struct APIRequest: Sendable {

    let method: HTTPMethod
    /// `API_PREFIX` (`/api/v1`) dahil DEĞİL — köke göreli: `services`, `staff/\(id)/services`.
    let path: String
    var query: [URLQueryItem] = []
    var body: (any Encodable & Sendable)?

    /// `false` ise `Authorization` başlığı gönderilmez ve 401'de yenileme denenmez.
    /// Yalnız `/auth/login`, `/auth/refresh` gibi public uçlar için.
    var requiresAuth = true

    /// Oturum token'ı yerine gönderilecek taşıyıcı.
    ///
    /// Giriş akışının ara token'ları (`mfa`, `tenant_select`) için gerekir:
    /// `/auth/2fa/setup` ve `/enable` challenge token'ını **gövdede değil**
    /// `Authorization` başlığında bekler. Verildiğinde 401'de yenileme denenmez —
    /// ara token'ın refresh'i yoktur, süresi dolduysa akış baştan başlar.
    var bearerOverride: String?

    /// Yan etkili POST'larda tekrar güvenliği. Faz 3'te `/appointments` zorunlu
    /// kılacak; imza sonradan değişmesin diye baştan taşınıyor.
    var idempotencyKey: String?

    static func get(_ path: String, query: [URLQueryItem] = []) -> APIRequest {
        APIRequest(method: .get, path: path, query: query)
    }

    static func post(_ path: String, body: (any Encodable & Sendable)? = nil) -> APIRequest {
        APIRequest(method: .post, path: path, body: body)
    }

    static func patch(_ path: String, body: (any Encodable & Sendable)? = nil) -> APIRequest {
        APIRequest(method: .patch, path: path, body: body)
    }

    static func put(_ path: String, body: (any Encodable & Sendable)? = nil) -> APIRequest {
        APIRequest(method: .put, path: path, body: body)
    }

    static func delete(_ path: String) -> APIRequest {
        APIRequest(method: .delete, path: path)
    }
}

/// Gövdesiz uçların (`204 No Content`) çözümleme hedefi.
nonisolated struct EmptyResponse: Decodable, Sendable {}

/// `{ "data": [...] }` sarmalayıcısı — liste uçlarının tamamı bu biçimde döner.
nonisolated struct ListEnvelope<Item: Decodable & Sendable>: Decodable, Sendable {
    let data: [Item]
}
