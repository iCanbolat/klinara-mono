import Foundation

/// Bellek-içi personel deposu.
///
/// Katalog mock'una bağlıdır: yetkinlik atanan hizmet gerçekten var olmalı,
/// yoksa matris ekranı var olmayan bir satırı işaretli gösterir.
final class MockStaffService: StaffService, @unchecked Sendable {

    private let lock = NSLock()
    private var _profiles: [StaffProfile]

    init(catalog: MockCatalogService) {
        _profiles = MockStaffSeed.profiles(services: catalog.snapshotServices, at: Date())
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    /// ``MockBookingService`` yetkinlik ve personel adlarını buradan okur —
    /// randevunun personelinin gerçekten o hizmeti yapabildiğini mock da
    /// doğrulasın diye. ``MockCatalogService/snapshotServices`` ile aynı amaç.
    var snapshotProfiles: [StaffProfile] { withLock { _profiles } }

    private func latency(_ seconds: Double = 0.4) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    private func notFound() -> APIError {
        .problem(ProblemDetails(code: .notFound, title: "Bulunamadı", status: 404))
    }

    func profiles() async throws -> [StaffProfile] {
        await latency(0.3)
        return withLock { _profiles }
    }

    func profile(id: String) async throws -> StaffProfile {
        await latency(0.2)
        return try withLock {
            guard let found = _profiles.first(where: { $0.id == id }) else { throw notFound() }
            return found
        }
    }

    func createProfile(_ input: CreateStaffProfileInput) async throws -> StaffProfile {
        await latency()
        return try withLock {
            guard !_profiles.contains(where: { $0.userId == input.userId }) else {
                throw APIError.problem(ProblemDetails(
                    code: .conflict,
                    title: "Çakışma",
                    detail: "Bu kullanıcı için personel profili zaten var",
                    status: 409
                ))
            }
            let profileId = MockIDs.uuid()
            let created = StaffProfile(
                id: profileId,
                tenantId: MockIDs.tenant,
                userId: input.userId,
                userFullName: MockStaffSeed.userName(for: input.userId),
                userEmail: MockStaffSeed.userEmail(for: input.userId),
                primaryBranchId: input.primaryBranchId,
                title: input.title,
                specialties: input.specialties ?? [],
                calendarColor: input.calendarColor,
                bio: input.bio,
                isVisibleOnline: input.isVisibleOnline ?? true,
                isActive: input.isActive ?? true,
                createdAt: Date(),
                services: MockStaffSeed.skills(
                    from: input.services ?? [],
                    staffProfileId: profileId
                )
            )
            _profiles.append(created)
            return created
        }
    }

    func updateProfile(id: String, _ input: UpdateStaffProfileInput) async throws -> StaffProfile {
        await latency()
        return try withLock {
            guard let index = _profiles.firstIndex(where: { $0.id == id }) else { throw notFound() }
            let old = _profiles[index]
            let updated = StaffProfile(
                id: old.id,
                tenantId: old.tenantId,
                userId: old.userId,
                userFullName: old.userFullName,
                userEmail: old.userEmail,
                primaryBranchId: input.primaryBranchId ?? old.primaryBranchId,
                title: input.title ?? old.title,
                specialties: input.specialties ?? old.specialties,
                calendarColor: input.calendarColor ?? old.calendarColor,
                bio: input.bio ?? old.bio,
                isVisibleOnline: input.isVisibleOnline ?? old.isVisibleOnline,
                isActive: input.isActive ?? old.isActive,
                createdAt: old.createdAt,
                services: old.services
            )
            _profiles[index] = updated
            return updated
        }
    }

    func replaceSkills(id: String, _ input: ReplaceStaffServicesInput) async throws -> StaffProfile {
        await latency(0.5)
        return try withLock {
            guard let index = _profiles.firstIndex(where: { $0.id == id }) else { throw notFound() }
            let old = _profiles[index]
            let updated = StaffProfile(
                id: old.id, tenantId: old.tenantId, userId: old.userId,
                userFullName: old.userFullName, userEmail: old.userEmail,
                primaryBranchId: old.primaryBranchId, title: old.title,
                specialties: old.specialties, calendarColor: old.calendarColor,
                bio: old.bio, isVisibleOnline: old.isVisibleOnline, isActive: old.isActive,
                createdAt: old.createdAt,
                services: MockStaffSeed.skills(from: input.services, staffProfileId: old.id)
            )
            _profiles[index] = updated
            return updated
        }
    }
}

enum MockStaffSeed {

    static let profileAyse = "f1000000-0000-4000-8000-000000000001"
    static let profileMehmet = "f1000000-0000-4000-8000-000000000002"

    static func userName(for userId: String) -> String {
        switch userId {
        case MockIDs.userOwner: "Ayşe Yılmaz"
        case MockIDs.userPractitioner: "Mehmet Demir"
        case MockIDs.userReceptionist: "Elif Kaya"
        default: "Yeni Personel"
        }
    }

    static func userEmail(for userId: String) -> String {
        switch userId {
        case MockIDs.userOwner: "ayse@demo-klinik.test"
        case MockIDs.userPractitioner: "mehmet@demo-klinik.test"
        case MockIDs.userReceptionist: "elif@demo-klinik.test"
        default: "yeni@demo-klinik.test"
        }
    }

    static func skills(
        from inputs: [StaffServiceSkillInput],
        staffProfileId: String
    ) -> [StaffServiceSkill] {
        inputs.map { input in
            StaffServiceSkill(
                id: MockIDs.uuid(),
                tenantId: MockIDs.tenant,
                staffProfileId: staffProfileId,
                serviceId: input.serviceId,
                branchId: input.branchId,
                customDurationMinutes: input.customDurationMinutes,
                customPriceMinor: input.customPriceMinor,
                isActive: input.isActive ?? true,
                createdAt: Date()
            )
        }
    }

    static func profiles(services: [ClinicService], at now: Date) -> [StaffProfile] {
        // Ayşe her şeyi yapar; Mehmet yalnız epilasyon — yetkinlik matrisinin
        // "herkes her hizmeti yapamaz" kuralı mock'ta da görünür olmalı.
        let allServiceIDs = services.filter(\.isActive).map(\.id)
        let epilationIDs = services
            .filter { $0.categoryId == MockCatalogSeed.categoryEpilasyon && $0.isActive }
            .map(\.id)

        return [
            StaffProfile(
                id: profileAyse, tenantId: MockIDs.tenant, userId: MockIDs.userOwner,
                userFullName: userName(for: MockIDs.userOwner),
                userEmail: userEmail(for: MockIDs.userOwner),
                primaryBranchId: MockIDs.branchNisantasi,
                title: "Dermatolog", specialties: ["Lazer", "Dolgu", "Botoks"],
                calendarColor: "#7F9A76", bio: "10 yıllık medikal estetik deneyimi.",
                isVisibleOnline: true, isActive: true, createdAt: now,
                services: skills(
                    from: allServiceIDs.map { StaffServiceSkillInput(serviceId: $0) },
                    staffProfileId: profileAyse
                )
            ),
            StaffProfile(
                id: profileMehmet, tenantId: MockIDs.tenant, userId: MockIDs.userPractitioner,
                userFullName: userName(for: MockIDs.userPractitioner),
                userEmail: userEmail(for: MockIDs.userPractitioner),
                primaryBranchId: MockIDs.branchBagdat,
                title: "Lazer Uygulayıcısı", specialties: ["Lazer epilasyon"],
                calendarColor: "#5E7856", bio: nil,
                isVisibleOnline: true, isActive: true, createdAt: now,
                services: skills(
                    from: epilationIDs.map {
                        StaffServiceSkillInput(serviceId: $0, branchId: MockIDs.branchBagdat)
                    },
                    staffProfileId: profileMehmet
                )
            ),
        ]
    }
}
