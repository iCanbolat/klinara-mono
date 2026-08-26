import Foundation

/// Hizmet kataloğu uçlarının istemci sözleşmesi (Batch 2.1).
///
/// Ekranlar yalnız bu protokole konuşur; arkasında ``LiveCatalogService`` ya da
/// ``MockCatalogService`` durabilir.
protocol CatalogService: Sendable {

    /// `GET /service-categories`
    func categories() async throws -> [ServiceCategory]

    /// `POST /service-categories`
    func createCategory(_ input: CreateServiceCategoryInput) async throws -> ServiceCategory

    /// `PATCH /service-categories/:id`
    func updateCategory(id: String, _ input: UpdateServiceCategoryInput) async throws -> ServiceCategory

    /// `DELETE /service-categories/:id` — **siler değil, pasife alır**.
    func deactivateCategory(id: String) async throws -> ServiceCategory

    /// `GET /services`
    func services() async throws -> [ClinicService]

    /// `GET /services/:id`
    func service(id: String) async throws -> ClinicService

    /// `POST /services`
    func createService(_ input: CreateServiceInput) async throws -> ClinicService

    /// `PATCH /services/:id`
    func updateService(id: String, _ input: UpdateServiceInput) async throws -> ClinicService

    /// `DELETE /services/:id` — **siler değil, pasife alır**.
    func deactivateService(id: String) async throws -> ClinicService
}

struct LiveCatalogService: CatalogService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func categories() async throws -> [ServiceCategory] {
        let response: ListEnvelope<ServiceCategory> = try await client.send(
            APIRequest.get("service-categories")
        )
        return response.data
    }

    func createCategory(_ input: CreateServiceCategoryInput) async throws -> ServiceCategory {
        try await client.send(APIRequest.post("service-categories", body: input))
    }

    func updateCategory(
        id: String,
        _ input: UpdateServiceCategoryInput
    ) async throws -> ServiceCategory {
        try await client.send(APIRequest.patch("service-categories/\(id)", body: input))
    }

    func deactivateCategory(id: String) async throws -> ServiceCategory {
        try await client.send(APIRequest.delete("service-categories/\(id)"))
    }

    func services() async throws -> [ClinicService] {
        let response: ListEnvelope<ClinicService> = try await client.send(APIRequest.get("services"))
        return response.data
    }

    func service(id: String) async throws -> ClinicService {
        try await client.send(APIRequest.get("services/\(id)"))
    }

    func createService(_ input: CreateServiceInput) async throws -> ClinicService {
        try await client.send(APIRequest.post("services", body: input))
    }

    func updateService(id: String, _ input: UpdateServiceInput) async throws -> ClinicService {
        try await client.send(APIRequest.patch("services/\(id)", body: input))
    }

    func deactivateService(id: String) async throws -> ClinicService {
        try await client.send(APIRequest.delete("services/\(id)"))
    }
}
