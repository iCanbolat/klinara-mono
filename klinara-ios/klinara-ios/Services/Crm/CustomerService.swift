import Foundation

/// Müşteri uçları — `apps/api/src/modules/crm`.
///
/// Müşteriler **kiracı kapsamlıdır**, şube değil: `X-Branch-Id` bu uçlarda
/// anlamsızdır (zararsız da olsa ``APIClient`` yine gönderir).
protocol CustomerService: Sendable {

    /// `GET /customers` — **cursor sayfalamalı**, en yeniden eskiye.
    /// `tagId` ve `source` sunucuda filtreliyor; arama için ``search(_:limit:)``.
    func customers(
        cursor: String?,
        limit: Int?,
        tagId: String?,
        source: CustomerSource?
    ) async throws -> Page<Customer>

    /// `GET /customers/search?q=` — ad **ve** telefon üzerinde, Türkçe duyarlı
    /// (`klinara_fold_tr` + trigram). Sunucu en az 2 karakter istiyor.
    ///
    /// Sayfalanmıyor: arama zaten daraltıcı bir işlem, ikinci sayfa yerine
    /// terimi daraltmak doğru cevap.
    ///
    /// Yanıt **çıplak dizi**dir, `{ "data": [...] }` zarfı YOKTUR — diğer liste
    /// uçlarından ayrılan tek yer burası (`CrmController.search` dizinin
    /// kendisini döndürüyor).
    func search(_ term: String, limit: Int?) async throws -> [Customer]

    /// `GET /customers/:id`
    func customer(id: String) async throws -> Customer

    /// `POST /customers`
    func create(_ input: CreateCustomerInput) async throws -> Customer

    /// `PATCH /customers/:id`
    func update(id: String, _ input: UpdateCustomerInput) async throws -> Customer

    /// `DELETE /customers/:id` — arşivler (soft delete) ve arşivlenen kaydı
    /// döndürür. Numara yeniden kullanılabilir hâle gelir.
    func archive(id: String) async throws -> Customer

    /// `PUT /customers/:id/tags` — etiket kümesini topluca ayarlar.
    func replaceTags(customerId: String, tagIds: [String]) async throws -> Customer

    /// `POST /customers/:id/merge` — `sourceId` arşivlenir, tüm kayıtları
    /// `targetId`e taşınır. `customer:merge` izni ister ve geri alınması
    /// pahalıdır.
    func merge(into targetId: String, sourceId: String) async throws -> CustomerMergeResult

    // MARK: Etiketler

    /// `GET /customer-tags`
    func tags() async throws -> [CustomerTag]

    /// `POST /customer-tags` — ad tekilliği **katlanmış** ada göre; çakışma `409`.
    func createTag(_ input: CustomerTagInput) async throws -> CustomerTag

    /// `PATCH /customer-tags/:id`
    func updateTag(id: String, _ input: CustomerTagInput) async throws -> CustomerTag

    /// `DELETE /customer-tags/:id` — atamalar da düşer.
    func deleteTag(id: String) async throws
}

struct LiveCustomerService: CustomerService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func customers(
        cursor: String?,
        limit: Int?,
        tagId: String?,
        source: CustomerSource?
    ) async throws -> Page<Customer> {
        var query: [URLQueryItem] = []
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let tagId { query.append(URLQueryItem(name: "tagId", value: tagId)) }
        if let source { query.append(URLQueryItem(name: "source", value: source.rawValue)) }
        return try await client.send(APIRequest.get("customers", query: query))
    }

    func search(_ term: String, limit: Int?) async throws -> [Customer] {
        var query = [URLQueryItem(name: "q", value: term)]
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        return try await client.send(APIRequest.get("customers/search", query: query))
    }

    func customer(id: String) async throws -> Customer {
        try await client.send(APIRequest.get("customers/\(id)"))
    }

    func create(_ input: CreateCustomerInput) async throws -> Customer {
        try await client.send(APIRequest.post("customers", body: input))
    }

    func update(id: String, _ input: UpdateCustomerInput) async throws -> Customer {
        try await client.send(APIRequest.patch("customers/\(id)", body: input))
    }

    func archive(id: String) async throws -> Customer {
        try await client.send(APIRequest.delete("customers/\(id)"))
    }

    func replaceTags(customerId: String, tagIds: [String]) async throws -> Customer {
        try await client.send(APIRequest.put(
            "customers/\(customerId)/tags",
            body: PutCustomerTagsInput(tagIds: tagIds)
        ))
    }

    func merge(into targetId: String, sourceId: String) async throws -> CustomerMergeResult {
        try await client.send(APIRequest.post(
            "customers/\(targetId)/merge",
            body: MergeCustomerInput(sourceCustomerId: sourceId)
        ))
    }

    func tags() async throws -> [CustomerTag] {
        let response: ListEnvelope<CustomerTag> = try await client.send(
            APIRequest.get("customer-tags")
        )
        return response.data
    }

    func createTag(_ input: CustomerTagInput) async throws -> CustomerTag {
        try await client.send(APIRequest.post("customer-tags", body: input))
    }

    func updateTag(id: String, _ input: CustomerTagInput) async throws -> CustomerTag {
        try await client.send(APIRequest.patch("customer-tags/\(id)", body: input))
    }

    func deleteTag(id: String) async throws {
        try await client.send(APIRequest.delete("customer-tags/\(id)"))
    }
}
