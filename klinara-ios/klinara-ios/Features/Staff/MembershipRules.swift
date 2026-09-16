import Foundation

/// Rol/şube düzenleyicisinin SAF kuralları — web `lib/staff/memberships.ts`
/// ve Android `MembershipDraft.kt` ile aynı.
///
/// ⚠️ Yetki kapısı DEĞİL; sunucu (`role-rules.ts`) aynısını zorluyor. Burada
/// olmalarının sebebi kullanıcıya kaydedemeyeceği bir değişikliği baştan
/// yaptırmamak ve NEDENİNİ satırın yanında söylemek:
///
/// 1. Kimse kendi rollerine dokunamaz.
/// 2. Kendi en yüksek rütbesinden yüksek bir rolü ne atayabilir ne kaldırabilir.
/// 3. `PUT` tam değiştirme ve gönderilen HER şube erişim kontrolünden geçiyor:
///    erişilemeyen şubedeki bir üyeliği "dokunmadan bırakmak" bile 403.
/// 4. Şube kapsamlı rol şube İSTER, kiracı kapsamlı rol şube ALMAZ.
nonisolated enum MembershipRules {

    struct Role: Sendable, Equatable, Identifiable {
        let key: String
        let rank: Int
        let isTenantScoped: Bool
        var id: String { key }
        var name: String { RoleName.turkish(key) }
    }

    /// `packages/shared/src/permissions.ts` → `ROLE_DEFINITIONS` (platform hariç).
    /// Yüksekten düşüğe.
    static let assignable: [Role] = [
        Role(key: "owner", rank: 80, isTenantScoped: true),
        Role(key: "manager", rank: 60, isTenantScoped: false),
        Role(key: "accountant", rank: 40, isTenantScoped: true),
        Role(key: "receptionist", rank: 30, isTenantScoped: false),
        Role(key: "practitioner", rank: 20, isTenantScoped: false),
    ]

    static func role(_ key: String) -> Role? { assignable.first { $0.key == key } }

    static func isTenantScoped(_ key: String) -> Bool { role(key)?.isTenantScoped ?? false }

    static func highestRank(roles: [String]) -> Int {
        roles.compactMap { role($0)?.rank }.max() ?? 0
    }

    static func assignableRoles(for roles: [String]) -> [Role] {
        let mine = highestRank(roles: roles)
        return assignable.filter { $0.rank <= mine }
    }

    struct Draft: Sendable, Equatable, Identifiable {
        /// İstemci anahtarı; sunucu kimliği değil.
        let id: String
        var roleKey: String
        var branchId: String?
    }

    enum Lock: Sendable, Equatable {
        case rank, branch
    }

    enum EditorLock: Sendable, Equatable {
        case selfEdit, branch
    }

    enum Issue: Sendable, Equatable {
        case branchRequired, duplicate
    }

    struct Viewer: Sendable, Equatable {
        let userId: String
        let roles: [String]
        let branchIds: [String]
        let tenantWide: Bool
    }

    static func lock(for draft: Draft, viewer: Viewer) -> Lock? {
        guard let role = role(draft.roleKey), role.rank <= highestRank(roles: viewer.roles) else {
            return .rank
        }
        if let branchId = draft.branchId, !viewer.tenantWide, !viewer.branchIds.contains(branchId) {
            return .branch
        }
        return nil
    }

    static func editorLock(userId: String, rows: [Draft], viewer: Viewer) -> EditorLock? {
        if viewer.userId == userId { return .selfEdit }
        if rows.contains(where: { lock(for: $0, viewer: viewer) == .branch }) { return .branch }
        return nil
    }

    static func issues(_ rows: [Draft]) -> [String: Issue] {
        var result: [String: Issue] = [:]
        var seen = Set<String>()
        for row in rows {
            if !isTenantScoped(row.roleKey), row.branchId == nil {
                result[row.id] = .branchRequired
                continue
            }
            let identity = "\(row.roleKey)|\(row.branchId ?? "")"
            if seen.contains(identity) { result[row.id] = .duplicate }
            seen.insert(identity)
        }
        return result
    }

    static func drafts(_ memberships: [MembershipSummary]) -> [Draft] {
        memberships.map { Draft(id: $0.id, roleKey: $0.roleKey, branchId: $0.branchId) }
    }

    static func inputs(_ rows: [Draft]) -> [MembershipInput] {
        rows.map {
            MembershipInput(roleKey: $0.roleKey, branchId: isTenantScoped($0.roleKey) ? nil : $0.branchId)
        }
    }

    /// Sıradan bağımsız eşitlik — "kaydedilmemiş değişiklik var mı".
    static func same(_ left: [Draft], _ right: [Draft]) -> Bool {
        func keys(_ rows: [Draft]) -> [String] {
            rows.map { "\($0.roleKey)|\($0.branchId ?? "")" }.sorted()
        }
        return keys(left) == keys(right)
    }
}
