import Foundation

// `apps/api/src/modules/tenancy/dto/tenant.dto.ts` karşılıkları.

/// `BranchResponseDto` — şube yönetim ekranının TAM şekli.
///
/// ``BranchSummary`` bunun dar hâli ve oturum boyunca şube menüsünü besliyor;
/// yönetim ekranı kod, telefon ve oluşturulma tarihine de bakıyor.
///
/// Şube **silinmez**: `isActive = false` pasife alır. `slug` oluşturulduktan
/// sonra değişmez.
nonisolated struct BranchDetail: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let tenantId: String
    let slug: String
    let name: String
    let timezone: String
    let phone: String?
    let address: String?
    let isActive: Bool
    let createdAt: Date

    var summary: BranchSummary {
        BranchSummary(id: id, name: name, timezone: timezone, address: address, isActive: isActive)
    }
}

/// `CreateBranchDto` — yalnız `branch:write` (owner).
nonisolated struct CreateBranchInput: Encodable, Sendable, Equatable {
    /// 3–50 karakter; küçük harf, rakam ve tire.
    let slug: String
    let name: String
    var timezone: String?
    var phone: String?
    var address: String?
}

/// `UpdateBranchDto` — telefon ve adres ``Nullable``: boşaltılan alan `null`
/// ile temizlenir, dokunulmayan alan hiç gönderilmez.
nonisolated struct UpdateBranchInput: Encodable, Sendable, Equatable {
    var name: String?
    var timezone: String?
    var phone: Nullable<String> = .unchanged
    var address: Nullable<String> = .unchanged
    var isActive: Bool?

    private enum CodingKeys: String, CodingKey {
        case name, timezone, phone, address, isActive
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(timezone, forKey: .timezone)
        try container.encode(phone, forKey: .phone)
        try container.encode(address, forKey: .address)
        try container.encodeIfPresent(isActive, forKey: .isActive)
    }

    var isEmpty: Bool {
        name == nil && timezone == nil && phone.isUnchanged && address.isUnchanged && isActive == nil
    }
}

enum BranchSlug {

    /// Şube adından kod önerisi: `İzmir Alsancak` → `izmir-alsancak`.
    /// Web'deki `slugify` ile aynı kural; doğrulamanın otoritesi sunucu.
    nonisolated static func suggest(from name: String) -> String {
        let folded = name
            .lowercased(with: Locale(identifier: "tr_TR"))
            .replacingOccurrences(of: "ı", with: "i")
            .folding(options: [.diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        var result = ""
        var lastWasDash = false
        for scalar in folded.unicodeScalars {
            if ("a"..."z").contains(Character(scalar)) || ("0"..."9").contains(Character(scalar)) {
                result.unicodeScalars.append(scalar)
                lastWasDash = false
            } else if !lastWasDash, !result.isEmpty {
                result.append("-")
                lastWasDash = true
            }
        }
        while result.hasSuffix("-") { result.removeLast() }
        if result.count > 50 {
            result = String(result.prefix(50))
            while result.hasSuffix("-") { result.removeLast() }
        }
        return result
    }

    nonisolated static func isValid(_ slug: String) -> Bool {
        (3...50).contains(slug.count)
            && slug.range(of: "^[a-z0-9]+(-[a-z0-9]+)*$", options: .regularExpression) != nil
    }
}
