import Foundation

/// `GET /users` — personel profili **mevcut bir kullanıcıya** bağlandığı için
/// (`CreateStaffProfileDto.userId`) personel eklemeden önce kullanıcı seçilmeli.
///
/// Faz 1'de yazılmış uçtur; burada yalnız Faz 2'nin ihtiyacı kadarı kullanılır.
protocol UsersService: Sendable {
    /// `GET /users`
    func users() async throws -> [UserProfile]
}

struct LiveUsersService: UsersService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func users() async throws -> [UserProfile] {
        let response: ListEnvelope<UserProfile> = try await client.send(APIRequest.get("users"))
        return response.data
    }
}

struct MockUsersService: UsersService {

    func users() async throws -> [UserProfile] {
        try? await Task.sleep(for: .seconds(0.3))
        return [
            MockUserSeed.user(id: MockIDs.userOwner, role: "owner"),
            MockUserSeed.user(id: MockIDs.userPractitioner, role: "practitioner"),
            MockUserSeed.user(id: MockIDs.userReceptionist, role: "receptionist"),
        ]
    }
}

enum MockUserSeed {

    static func user(id: String, role: String) -> UserProfile {
        UserProfile(
            id: id,
            email: MockStaffSeed.userEmail(for: id),
            fullName: MockStaffSeed.userName(for: id),
            locale: "tr-TR",
            isActive: true,
            phone: "+9053212345\(role.count)0",
            phoneVerified: true,
            hasPassword: true,
            lastLoginAt: nil,
            createdAt: "2026-05-02T09:30:00.000Z",
            memberships: [
                MembershipSummary(
                    id: MockIDs.uuid(),
                    branchId: MockIDs.branchNisantasi,
                    roleKey: role,
                    roleName: RoleName.turkish(role)
                )
            ]
        )
    }
}
