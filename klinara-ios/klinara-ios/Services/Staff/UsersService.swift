import Foundation

/// `GET /users` — personel profili **mevcut bir kullanıcıya** bağlandığı için
/// (`CreateStaffProfileDto.userId`) personel eklemeden önce kullanıcı seçilmeli.
///
/// Faz 1'de yazılmış uçtur; burada yalnız Faz 2'nin ihtiyacı kadarı kullanılır.
protocol UsersService: Sendable {
    /// `GET /users`
    func users() async throws -> [UserProfile]

    /// `GET /users/:id/memberships`
    func memberships(userId: String) async throws -> [MembershipSummary]

    /// `PUT /users/:id/memberships` — rol kümesinin **tamamını** değiştirir;
    /// boş liste kişiyi klinikten çıkarır. Kurallar ``MembershipRules``'ta.
    func replaceMemberships(userId: String, _ memberships: [MembershipInput]) async throws -> [MembershipSummary]

    /// `GET /invitations`
    func invitations() async throws -> [Invitation]

    /// `POST /invitations`
    func invite(_ input: CreateInvitationInput) async throws -> Invitation

    /// `DELETE /invitations/:id` — `204`.
    func revokeInvitation(id: String) async throws
}

// MARK: - Modeller

/// `MembershipInputDto`. Kiracı kapsamlı rolde `branchId` GÖNDERİLMEZ (400).
nonisolated struct MembershipInput: Encodable, Sendable, Equatable {
    let roleKey: String
    var branchId: String?
}

nonisolated private struct PutMembershipsBody: Encodable, Sendable {
    let memberships: [MembershipInput]
}

/// `InvitationResponseDto`.
nonisolated struct Invitation: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let email: String
    let roleKey: String
    /// `nil` = kiracı kapsamlı rol.
    let branchId: String?
    let expiresAt: Date
    let createdAt: Date
    var acceptedAt: Date?
    var revokedAt: Date?
    /// Yalnız üretim dışında döner (e-posta loga yazılırken).
    var link: String?

    var isPending: Bool { acceptedAt == nil && revokedAt == nil }

    func isExpired(now: Date) -> Bool { expiresAt < now }
}

/// `CreateInvitationDto`.
nonisolated struct CreateInvitationInput: Encodable, Sendable, Equatable {
    let email: String
    let roleKey: String
    var branchId: String?
    var fullName: String?
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

    func memberships(userId: String) async throws -> [MembershipSummary] {
        let response: ListEnvelope<MembershipSummary> = try await client.send(
            APIRequest.get("users/\(userId)/memberships")
        )
        return response.data
    }

    func replaceMemberships(userId: String, _ memberships: [MembershipInput]) async throws -> [MembershipSummary] {
        let response: ListEnvelope<MembershipSummary> = try await client.send(
            APIRequest.put("users/\(userId)/memberships", body: PutMembershipsBody(memberships: memberships))
        )
        return response.data
    }

    func invitations() async throws -> [Invitation] {
        let response: ListEnvelope<Invitation> = try await client.send(APIRequest.get("invitations"))
        return response.data
    }

    func invite(_ input: CreateInvitationInput) async throws -> Invitation {
        try await client.send(APIRequest.post("invitations", body: input))
    }

    func revokeInvitation(id: String) async throws {
        try await client.send(APIRequest.delete("invitations/\(id)"))
    }
}

/// Bellek-içi kullanıcı, üyelik ve davet deposu.
///
/// Üyelik yazımı sunucunun iki "sessiz" kuralını da taklit ediyor — son sahip
/// kaldırılamaz, kiracı kapsamlı rol şube almaz — ki mock modda editör
/// yanlış bir şeyi başarılı gibi göstermesin.
final class MockUsersService: UsersService, @unchecked Sendable {

    private let lock = NSLock()
    private var _memberships: [String: [MembershipSummary]]
    private var _invitations: [Invitation]

    init() {
        _memberships = [
            MockIDs.userOwner: [
                MembershipSummary(id: MockIDs.uuid(), branchId: nil, roleKey: "owner", roleName: RoleName.turkish("owner")),
            ],
            MockIDs.userPractitioner: [
                MembershipSummary(
                    id: MockIDs.uuid(), branchId: MockIDs.branchNisantasi,
                    roleKey: "practitioner", roleName: RoleName.turkish("practitioner")
                ),
                MembershipSummary(
                    id: MockIDs.uuid(), branchId: MockIDs.branchBagdat,
                    roleKey: "practitioner", roleName: RoleName.turkish("practitioner")
                ),
            ],
            MockIDs.userReceptionist: [
                MembershipSummary(
                    id: MockIDs.uuid(), branchId: MockIDs.branchNisantasi,
                    roleKey: "receptionist", roleName: RoleName.turkish("receptionist")
                ),
            ],
        ]
        let now = Date()
        _invitations = [
            Invitation(
                id: MockIDs.uuid(), email: "yeni@demo-klinik.test", roleKey: "practitioner",
                branchId: MockIDs.branchBagdat, expiresAt: now.addingTimeInterval(6 * 86_400),
                createdAt: now.addingTimeInterval(-86_400)
            ),
        ]
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    func users() async throws -> [UserProfile] {
        try? await Task.sleep(for: .seconds(0.3))
        return withLock {
            [MockIDs.userOwner, MockIDs.userPractitioner, MockIDs.userReceptionist].map { id in
                MockUserSeed.user(id: id, memberships: _memberships[id] ?? [])
            }
        }
    }

    func memberships(userId: String) async throws -> [MembershipSummary] {
        try? await Task.sleep(for: .seconds(0.2))
        return withLock { _memberships[userId] ?? [] }
    }

    func replaceMemberships(userId: String, _ memberships: [MembershipInput]) async throws -> [MembershipSummary] {
        try? await Task.sleep(for: .seconds(0.4))
        return try withLock {
            for input in memberships where MembershipRules.isTenantScoped(input.roleKey) == (input.branchId != nil) {
                throw APIError.problem(ProblemDetails(
                    code: .validationFailed,
                    title: input.branchId == nil ? "Bu rol için şube seçilmeli" : "Bu rol şubeye bağlanamaz",
                    status: 400
                ))
            }
            let ownersElsewhere = _memberships
                .filter { $0.key != userId }
                .values.flatMap { $0 }
                .contains { $0.roleKey == "owner" }
            if !ownersElsewhere, !memberships.contains(where: { $0.roleKey == "owner" }),
               (_memberships[userId] ?? []).contains(where: { $0.roleKey == "owner" }) {
                throw APIError.problem(ProblemDetails(
                    code: .conflict,
                    title: "Kliniğin son işletme sahibi kaldırılamaz",
                    status: 409
                ))
            }
            let updated = memberships.map {
                MembershipSummary(
                    id: MockIDs.uuid(), branchId: $0.branchId,
                    roleKey: $0.roleKey, roleName: RoleName.turkish($0.roleKey)
                )
            }
            _memberships[userId] = updated
            return updated
        }
    }

    func invitations() async throws -> [Invitation] {
        try? await Task.sleep(for: .seconds(0.3))
        return withLock { _invitations }
    }

    func invite(_ input: CreateInvitationInput) async throws -> Invitation {
        try? await Task.sleep(for: .seconds(0.4))
        return withLock {
            let now = Date()
            let invitation = Invitation(
                id: MockIDs.uuid(), email: input.email, roleKey: input.roleKey,
                branchId: input.branchId, expiresAt: now.addingTimeInterval(7 * 86_400), createdAt: now
            )
            _invitations.insert(invitation, at: 0)
            return invitation
        }
    }

    func revokeInvitation(id: String) async throws {
        try? await Task.sleep(for: .seconds(0.3))
        withLock { _invitations.removeAll { $0.id == id } }
    }
}

enum MockUserSeed {

    static func user(id: String, memberships: [MembershipSummary]) -> UserProfile {
        UserProfile(
            id: id,
            email: MockStaffSeed.userEmail(for: id),
            fullName: MockStaffSeed.userName(for: id),
            locale: "tr-TR",
            isActive: true,
            phone: nil,
            phoneVerified: false,
            hasPassword: true,
            lastLoginAt: nil,
            createdAt: "2026-05-02T09:30:00.000Z",
            memberships: memberships
        )
    }
}
