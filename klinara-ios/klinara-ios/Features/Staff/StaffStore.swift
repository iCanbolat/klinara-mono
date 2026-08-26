import SwiftUI

/// Personel profillerinin oturum ömürlü kopyası.
@MainActor
@Observable
final class StaffStore {

    private let service: any StaffService

    private(set) var state: LoadState<[StaffProfile]> = .loading
    private(set) var isSaving = false

    init(service: any StaffService) {
        self.service = service
    }

    var profiles: [StaffProfile] { state.value ?? [] }

    func load(force: Bool = false) async {
        if !force, state.value != nil { return }
        state = .loading
        do {
            state = .loaded(try await service.profiles())
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    func reload() async { await load(force: true) }

    func profile(id: String) -> StaffProfile? {
        profiles.first { $0.id == id }
    }

    func create(_ input: CreateStaffProfileInput) async throws -> StaffProfile {
        try await mutating {
            let created = try await service.createProfile(input)
            apply { $0.append(created) }
            return created
        }
    }

    func update(id: String, _ input: UpdateStaffProfileInput) async throws -> StaffProfile {
        try await mutating {
            let updated = try await service.updateProfile(id: id, input)
            replace(updated)
            return updated
        }
    }

    /// `PUT /staff/:id/services` — listenin **tamamını** değiştirir.
    func replaceSkills(id: String, skills: [StaffServiceSkillInput]) async throws -> StaffProfile {
        try await mutating {
            let updated = try await service.replaceSkills(
                id: id,
                ReplaceStaffServicesInput(services: skills)
            )
            replace(updated)
            return updated
        }
    }

    private func mutating<T>(_ work: () async throws -> T) async throws -> T {
        isSaving = true
        defer { isSaving = false }
        return try await work()
    }

    private func replace(_ profile: StaffProfile) {
        apply { list in
            if let index = list.firstIndex(where: { $0.id == profile.id }) {
                list[index] = profile
            }
        }
    }

    private func apply(_ change: (inout [StaffProfile]) -> Void) {
        var updated = profiles
        change(&updated)
        state = .loaded(updated)
    }
}
