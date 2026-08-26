import Foundation

/// Personel profili ve hizmet yetkinliği uçları (Batch 2.2).
protocol StaffService: Sendable {

    /// `GET /staff`
    func profiles() async throws -> [StaffProfile]

    /// `GET /staff/:id`
    func profile(id: String) async throws -> StaffProfile

    /// `POST /staff`
    func createProfile(_ input: CreateStaffProfileInput) async throws -> StaffProfile

    /// `PATCH /staff/:id`
    func updateProfile(id: String, _ input: UpdateStaffProfileInput) async throws -> StaffProfile

    /// `PUT /staff/:id/services` — yetkinlik listesinin tamamını değiştirir.
    func replaceSkills(id: String, _ input: ReplaceStaffServicesInput) async throws -> StaffProfile
}

struct LiveStaffService: StaffService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func profiles() async throws -> [StaffProfile] {
        let response: ListEnvelope<StaffProfile> = try await client.send(APIRequest.get("staff"))
        return response.data
    }

    func profile(id: String) async throws -> StaffProfile {
        try await client.send(APIRequest.get("staff/\(id)"))
    }

    func createProfile(_ input: CreateStaffProfileInput) async throws -> StaffProfile {
        try await client.send(APIRequest.post("staff", body: input))
    }

    func updateProfile(id: String, _ input: UpdateStaffProfileInput) async throws -> StaffProfile {
        try await client.send(APIRequest.patch("staff/\(id)", body: input))
    }

    func replaceSkills(id: String, _ input: ReplaceStaffServicesInput) async throws -> StaffProfile {
        try await client.send(APIRequest.put("staff/\(id)/services", body: input))
    }
}
