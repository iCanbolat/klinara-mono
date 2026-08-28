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

    /// Yan etkili POST'larda tekrar güvenliği. `POST /appointments` bunu
    /// destekler: aynı anahtarla ikinci istek yeni randevu üretmez, ilkinin
    /// yanıtını tekrar döndürür.
    var idempotencyKey: String?

    /// İyimser kilit. `PATCH /appointments/:id` ve `POST /:id/reschedule`
    /// bunu **zorunlu** kılar: başlık yoksa sunucu `428`, bayatsa `409
    /// VERSION_CONFLICT` döner. Değer ``weakETag(_:)`` ile kurulur — yanıt
    /// başlığını okumaya gerek yok, sürüm gövdedeki `version` alanında geliyor.
    var ifMatch: String?

    static func get(_ path: String, query: [URLQueryItem] = []) -> APIRequest {
        APIRequest(method: .get, path: path, query: query)
    }

    static func post(
        _ path: String,
        body: (any Encodable & Sendable)? = nil,
        idempotencyKey: String? = nil,
        ifMatch: String? = nil
    ) -> APIRequest {
        APIRequest(
            method: .post,
            path: path,
            body: body,
            idempotencyKey: idempotencyKey,
            ifMatch: ifMatch
        )
    }

    static func patch(
        _ path: String,
        body: (any Encodable & Sendable)? = nil,
        ifMatch: String? = nil
    ) -> APIRequest {
        APIRequest(method: .patch, path: path, body: body, ifMatch: ifMatch)
    }

    static func put(_ path: String, body: (any Encodable & Sendable)? = nil) -> APIRequest {
        APIRequest(method: .put, path: path, body: body)
    }

    /// `ifMatch`: `DELETE /package-definitions/:id` gibi iyimser kilit isteyen
    /// uçlar için — silme de bayat bir sürüm üzerinde yapılabilir.
    static func delete(_ path: String, ifMatch: String? = nil) -> APIRequest {
        APIRequest(method: .delete, path: path, ifMatch: ifMatch)
    }
}

/// Gövdesiz uçların (`204 No Content`) çözümleme hedefi.
nonisolated struct EmptyResponse: Decodable, Sendable {}

/// `{ "data": [...] }` sarmalayıcısı — liste uçlarının tamamı bu biçimde döner.
nonisolated struct ListEnvelope<Item: Decodable & Sendable>: Decodable, Sendable {
    let data: [Item]
}

/// Cursor sayfalamasının sayfa bilgisi — `common/pagination.ts` karşılığı.
nonisolated struct PageInfo: Decodable, Sendable, Equatable {
    let nextCursor: String?
    let hasMore: Bool
}

/// `{ "data": [...], "pageInfo": { … } }` — sayfalanan uçların zarfı.
///
/// ``ListEnvelope``'dan ayrı bir tip: cursor'u atan bir çağrı yeri sessizce
/// ilk sayfayla yetinirdi, bu ayrım derleyiciye söyletiyor.
nonisolated struct Page<Item: Decodable & Sendable>: Decodable, Sendable {
    let data: [Item]
    let pageInfo: PageInfo

    static var empty: Page<Item> {
        Page(data: [], pageInfo: PageInfo(nextCursor: nil, hasMore: false))
    }
}

/// `version` → `If-Match` başlığı. Sunucu `W/"3"` ve `"3"` biçimlerinin
/// ikisini de kabul ediyor; zayıf biçim `common/http/etag.ts`'in ürettiğiyle aynı.
nonisolated func weakETag(_ version: Int) -> String { "W/\"\(version)\"" }
