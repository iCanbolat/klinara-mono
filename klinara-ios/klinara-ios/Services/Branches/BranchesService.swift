import Foundation

/// Şube yönetimi uçları ("Şube ve Personel").
///
/// `GET branches` giriş akışında ``AuthService/branches()`` ile de çağrılıyor
/// ama orada dar ``BranchSummary`` yeterli. Yönetim ekranı tam şekle bakıyor.
protocol BranchesService: Sendable {
    /// `GET /branches` — pasifler dahil kiracının tüm şubeleri.
    func branches() async throws -> [BranchDetail]
    /// `POST /branches`
    func create(_ input: CreateBranchInput) async throws -> BranchDetail
    /// `PATCH /branches/:id`
    func update(id: String, _ input: UpdateBranchInput) async throws -> BranchDetail
}

struct LiveBranchesService: BranchesService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func branches() async throws -> [BranchDetail] {
        let response: ListEnvelope<BranchDetail> = try await client.send(APIRequest.get("branches"))
        return response.data
    }

    func create(_ input: CreateBranchInput) async throws -> BranchDetail {
        try await client.send(APIRequest.post("branches", body: input))
    }

    func update(id: String, _ input: UpdateBranchInput) async throws -> BranchDetail {
        try await client.send(APIRequest.patch("branches/\(id)", body: input))
    }
}

/// Bellek-içi şube deposu. ``MockIDs`` şubeleriyle tohumlanıyor ki personel
/// ve takvim mock'larının şube kimlikleri burada da tanınsın.
final class MockBranchesService: BranchesService, @unchecked Sendable {

    private let lock = NSLock()
    private var _branches: [BranchDetail]

    init() {
        let created = Date(timeIntervalSince1970: 1_775_000_000)
        _branches = [
            BranchDetail(
                id: MockIDs.branchNisantasi, tenantId: MockIDs.tenant, slug: "nisantasi",
                name: "Nişantaşı", timezone: "Europe/Istanbul", phone: "+902122345678",
                address: "Teşvikiye Cad. No: 12, Şişli", isActive: true, createdAt: created
            ),
            BranchDetail(
                id: MockIDs.branchBagdat, tenantId: MockIDs.tenant, slug: "bagdat-caddesi",
                name: "Bağdat Caddesi", timezone: "Europe/Istanbul", phone: nil,
                address: "Bağdat Cad. No: 310, Kadıköy", isActive: true, createdAt: created
            ),
        ]
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    func branches() async throws -> [BranchDetail] {
        try? await Task.sleep(for: .seconds(0.3))
        return withLock { _branches }
    }

    func create(_ input: CreateBranchInput) async throws -> BranchDetail {
        try? await Task.sleep(for: .seconds(0.4))
        return try withLock {
            guard !_branches.contains(where: { $0.slug == input.slug }) else {
                throw APIError.problem(ProblemDetails(
                    code: .conflict,
                    title: "Bu şube kodu zaten kullanımda",
                    detail: "\"\(input.slug)\" bu klinikte başka bir şubeye ait.",
                    status: 409
                ))
            }
            let branch = BranchDetail(
                id: MockIDs.uuid(), tenantId: MockIDs.tenant, slug: input.slug, name: input.name,
                timezone: input.timezone ?? "Europe/Istanbul", phone: input.phone,
                address: input.address, isActive: true, createdAt: Date()
            )
            _branches.append(branch)
            return branch
        }
    }

    func update(id: String, _ input: UpdateBranchInput) async throws -> BranchDetail {
        try? await Task.sleep(for: .seconds(0.4))
        return try withLock {
            guard let index = _branches.firstIndex(where: { $0.id == id }) else {
                throw APIError.problem(ProblemDetails(code: .notFound, title: "Bulunamadı", status: 404))
            }
            let old = _branches[index]
            let updated = BranchDetail(
                id: old.id, tenantId: old.tenantId, slug: old.slug,
                name: input.name ?? old.name,
                timezone: input.timezone ?? old.timezone,
                phone: input.phone.applied(to: old.phone),
                address: input.address.applied(to: old.address),
                isActive: input.isActive ?? old.isActive,
                createdAt: old.createdAt
            )
            _branches[index] = updated
            return updated
        }
    }
}
