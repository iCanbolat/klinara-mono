import Foundation

/// Müşteri uçları — `apps/api/src/modules/crm`.
///
/// Müşteriler **kiracı kapsamlıdır**, şube değil: `X-Branch-Id` bu uçlarda
/// anlamsızdır (zararsız da olsa ``APIClient`` yine gönderir).
protocol CustomerService: Sendable {

    /// `GET /customers` — sayfalama ve arama parametresi **yok**; kiracının
    /// arşivlenmemiş tüm müşterileri, en yeniden eskiye döner.
    func customers() async throws -> [Customer]

    /// `GET /customers/:id`
    func customer(id: String) async throws -> Customer

    /// `POST /customers`
    func create(_ input: CreateCustomerInput) async throws -> Customer

    /// `PATCH /customers/:id`
    func update(id: String, _ input: UpdateCustomerInput) async throws -> Customer

    /// `DELETE /customers/:id` — arşivler (soft delete) ve arşivlenen kaydı
    /// döndürür. Numara yeniden kullanılabilir hâle gelir.
    func archive(id: String) async throws -> Customer
}

struct LiveCustomerService: CustomerService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func customers() async throws -> [Customer] {
        let response: ListEnvelope<Customer> = try await client.send(APIRequest.get("customers"))
        return response.data
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
}
