import Foundation
import Testing
@testable import klinara_ios

/// "Şube ve Personel" (A7.4–A7.5): şube yönetimi, rol/şube ataması ve şube süzgeci.
///
/// Gövdeler `klinara-fixtures/{branches,staff}` altındaki dosyaların aynısı.
@Suite("Şube ve Personel — çözümleme")
struct BranchStaffDecodingTests {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try APIClient.decoder.decode(T.self, from: Data(json.utf8))
    }

    @Test("Tam şube yanıtı çözülür; pasif şube dar özete taşınır")
    func decodesBranchDetail() throws {
        let list = try decode(ListEnvelope<BranchDetail>.self, """
        {"data":[
          {"id":"b1","tenantId":"t1","slug":"nisantasi","name":"Nişantaşı","timezone":"Europe/Istanbul",
           "phone":"+902122345678","address":"Teşvikiye Cad. No: 12, Şişli","isActive":true,
           "createdAt":"2026-04-01T08:00:00.000Z"},
          {"id":"b3","tenantId":"t1","slug":"kadikoy","name":"Kadıköy","timezone":"Europe/Istanbul",
           "phone":null,"address":null,"isActive":false,"createdAt":"2026-05-10T08:00:00.000Z"}
        ]}
        """)
        #expect(list.data.count == 2)
        #expect(list.data[1].summary.isActive == false)
        #expect(list.data[1].phone == nil)
    }

    @Test("Personel profili branchIds taşır; eski sunucu yanıtında alan yoksa boş sayılır")
    func decodesStaffBranchIds() throws {
        let base = """
        "id":"p1","tenantId":"t1","userId":"u1","userFullName":"Mehmet Demir","userEmail":"m@d.test",
        "primaryBranchId":"b2","title":null,"specialties":[],"calendarColor":null,"bio":null,
        "isVisibleOnline":true,"isActive":true,"createdAt":"2026-05-02T09:30:00.000Z","services":[]
        """
        let fresh = try decode(StaffProfile.self, "{\(base),\"branchIds\":[\"b1\",\"b2\"]}")
        #expect(fresh.worksIn(branchId: "b1"))
        #expect(fresh.worksIn(branchId: "b2"))
        #expect(!fresh.worksIn(branchId: "b3"))

        let legacy = try decode(StaffProfile.self, "{\(base)}")
        #expect(legacy.branchIds == nil)
        // Ana şube tek başına yeter — sunucu süzgecinin "VEYA"sı.
        #expect(legacy.worksIn(branchId: "b2"))
        #expect(!legacy.worksIn(branchId: "b1"))
    }

    @Test("Davet listesi çözülür; kiracı kapsamlı davetin şubesi yok")
    func decodesInvitations() throws {
        let list = try decode(ListEnvelope<Invitation>.self, """
        {"data":[
          {"id":"a1","email":"yeni@demo-klinik.test","roleKey":"practitioner","branchId":"b2",
           "expiresAt":"2026-09-23T10:00:00.000Z","createdAt":"2026-09-16T10:00:00.000Z",
           "acceptedAt":null,"revokedAt":null},
          {"id":"a2","email":"ortak@demo-klinik.test","roleKey":"owner","branchId":null,
           "expiresAt":"2026-09-20T10:00:00.000Z","createdAt":"2026-09-13T10:00:00.000Z",
           "acceptedAt":null,"revokedAt":null}
        ]}
        """)
        #expect(list.data.allSatisfy { $0.isPending })
        #expect(list.data[1].branchId == nil)
        let now = KlinaraCoding.parseTimestamp("2026-09-21T00:00:00.000Z")!
        #expect(list.data[1].isExpired(now: now))
        #expect(!list.data[0].isExpired(now: now))
    }
}

@Suite("Şube ve Personel — PATCH gövdeleri")
struct BranchStaffEncodingTests {

    private func json(_ value: some Encodable) throws -> [String: Any] {
        let data = try KlinaraCoding.encoder().encode(value)
        return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? [String: Any] ?? [:]
    }

    @Test("Profil: temizlenen alan null, dokunulmayan alan HİÇ gönderilmez")
    func staffProfileNullable() throws {
        var input = UpdateStaffProfileInput()
        input.primaryBranchId = .clear
        input.title = .set("Uzman")
        let body = try json(input)

        #expect(body.keys.sorted() == ["primaryBranchId", "title"])
        #expect(body["primaryBranchId"] is NSNull)
        #expect(body["title"] as? String == "Uzman")
    }

    @Test("Taslak yalnız değişen alanları gönderir; boşaltılan unvan temizlenir")
    func draftSendsOnlyChanges() throws {
        let profile = StaffProfile(
            id: "p1", tenantId: "t1", userId: "u1", userFullName: "A", userEmail: "a@b.c",
            primaryBranchId: "b1", title: "Uzman", specialties: [], calendarColor: "#7F9A76",
            bio: nil, isVisibleOnline: true, isActive: true, createdAt: Date(), services: []
        )
        var draft = StaffProfileDraft(profile: profile)
        draft.title = ""
        draft.primaryBranchId = nil
        let body = try json(draft.updateInput())

        #expect(body.keys.sorted() == ["primaryBranchId", "title"])
        #expect(body["title"] is NSNull)
        #expect(body["primaryBranchId"] is NSNull)
    }

    @Test("Şube: boş telefon null, pasife alma tek alan")
    func branchNullable() throws {
        var input = UpdateBranchInput()
        #expect(input.isEmpty)
        input.phone = .text("  ")
        input.isActive = false
        let body = try json(input)

        #expect(body.keys.sorted() == ["isActive", "phone"])
        #expect(body["phone"] is NSNull)
        #expect(body["isActive"] as? Bool == false)
    }

    @Test("Şube kodu Türkçe addan türetilir ve sunucu kuralına uyar")
    func slug() {
        #expect(BranchSlug.suggest(from: "İzmir Alsancak") == "izmir-alsancak")
        #expect(BranchSlug.suggest(from: "  Nişantaşı / Şişli ") == "nisantasi-sisli")
        #expect(BranchSlug.suggest(from: "Çeşme Ğ Üsküdar Ö") == "cesme-g-uskudar-o")
        #expect(BranchSlug.isValid("izmir-alsancak"))
        #expect(!BranchSlug.isValid("iz"))
        #expect(!BranchSlug.isValid("Izmir"))
        #expect(!BranchSlug.isValid("izmir--alsancak"))
    }
}

@Suite("Şube ve Personel — rol kuralları")
struct MembershipRulesTests {

    private let owner = MembershipRules.Viewer(userId: "o", roles: ["owner"], branchIds: [], tenantWide: true)
    private let managerB1 = MembershipRules.Viewer(userId: "m", roles: ["manager"], branchIds: ["b1"], tenantWide: false)

    private func draft(_ id: String, _ role: String, _ branch: String?) -> MembershipRules.Draft {
        MembershipRules.Draft(id: id, roleKey: role, branchId: branch)
    }

    @Test("Kimse kendinden yüksek rolü atayamaz")
    func assignable() {
        #expect(MembershipRules.assignableRoles(for: owner.roles).map(\.key)
            == ["owner", "manager", "receptionist", "practitioner"])
        #expect(!MembershipRules.assignableRoles(for: managerB1.roles).map(\.key).contains("owner"))
    }

    @Test("Satır kilidi: rütbe ve erişilemeyen şube")
    func rowLock() {
        #expect(MembershipRules.lock(for: draft("1", "owner", nil), viewer: managerB1) == .rank)
        #expect(MembershipRules.lock(for: draft("2", "practitioner", "b2"), viewer: managerB1) == .branch)
        #expect(MembershipRules.lock(for: draft("3", "practitioner", "b1"), viewer: managerB1) == nil)
        #expect(MembershipRules.lock(for: draft("4", "practitioner", "b2"), viewer: owner) == nil)
    }

    @Test("Erişilemeyen tek şube satırı tüm düzenleyiciyi kilitler; kendi rolü kilitli")
    func editorLock() {
        let rows = [draft("1", "practitioner", "b1"), draft("2", "receptionist", "b2")]
        #expect(MembershipRules.editorLock(userId: "u", rows: rows, viewer: managerB1) == .branch)
        #expect(MembershipRules.editorLock(userId: "u", rows: rows, viewer: owner) == nil)
        #expect(MembershipRules.editorLock(userId: "o", rows: rows, viewer: owner) == .selfEdit)
        // Rütbe kilidi düzenleyiciyi kilitlemez — satır olduğu gibi geri gider.
        #expect(MembershipRules.editorLock(userId: "u", rows: [draft("3", "owner", nil)], viewer: managerB1) == nil)
    }

    @Test("Doğrulama: şube kapsamlı rolde şube zorunlu, tekrar yasak; kiracı rolü şubesiz gider")
    func validation() {
        let rows = [
            draft("a", "practitioner", nil),
            draft("b", "receptionist", "b1"),
            draft("c", "receptionist", "b1"),
            draft("d", "owner", nil),
        ]
        #expect(MembershipRules.issues(rows) == ["a": .branchRequired, "c": .duplicate])
        #expect(MembershipRules.inputs([draft("d", "owner", "b1")]) == [MembershipInput(roleKey: "owner")])
        #expect(MembershipRules.same(rows, rows.reversed()))
    }
}

@Suite("Şube ve Personel — mock sözleşmesi")
struct BranchStaffMockTests {

    @Test("Son işletme sahibi kaldırılamaz (409)")
    func lastOwnerSurvives() async {
        let users = MockUsersService()
        await #expect(throws: APIError.self) {
            _ = try await users.replaceMemberships(
                userId: MockIDs.userOwner,
                [MembershipInput(roleKey: "manager", branchId: MockIDs.branchNisantasi)]
            )
        }
    }

    @Test("Aynı kodla ikinci şube açılamaz; pasife alma yalnız isActive'i değiştirir")
    func branchWrites() async throws {
        let branches = MockBranchesService()
        await #expect(throws: APIError.self) {
            _ = try await branches.create(CreateBranchInput(slug: "nisantasi", name: "Kopya"))
        }
        var patch = UpdateBranchInput()
        patch.isActive = false
        let updated = try await branches.update(id: MockIDs.branchBagdat, patch)
        #expect(updated.isActive == false)
        #expect(updated.address != nil)
    }
}
