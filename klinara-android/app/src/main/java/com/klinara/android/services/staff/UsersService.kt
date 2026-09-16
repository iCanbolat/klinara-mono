package com.klinara.android.services.staff

import com.klinara.android.services.auth.MembershipSummary
import com.klinara.android.services.auth.UserProfile
import com.klinara.android.services.contracts.RoleDefinitions
import com.klinara.android.services.contracts.RoleNames
import com.klinara.android.services.contracts.RoleScope
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import java.time.Duration
import java.time.Instant
import kotlin.random.Random

/**
 * Kiracının kullanıcıları, rolleri ve davetleri.
 *
 * `GET users` A7.2'de personel oluşturma için geldi. A7.5 rol/şube atamasını
 * (`PUT users/:id/memberships`, `user:write` VEYA `user:invite`) ve davetleri
 * (`user:invite`) ekledi — iOS `UsersService` paritesi.
 */
interface UsersService {
    suspend fun users(): List<UserProfile>

    /** `GET users/:id/memberships`. */
    suspend fun memberships(userId: String): List<MembershipSummary>

    /**
     * `PUT users/:id/memberships` — kümenin TAMAMI değiştirilir; boş liste kişiyi klinikten
     * çıkarır. Kurallar `MembershipDraft`'ta yansıtılıyor, otorite sunucu.
     */
    suspend fun replaceMemberships(
        userId: String,
        memberships: List<MembershipInput>,
    ): List<MembershipSummary>

    /** `GET invitations`. */
    suspend fun invitations(): List<Invitation>

    /** `POST invitations`. */
    suspend fun invite(input: CreateInvitationInput): Invitation

    /** `DELETE invitations/:id` — 204. */
    suspend fun revokeInvitation(id: String)
}

class LiveUsersService internal constructor(
    private val client: ApiClient,
) : UsersService {
    override suspend fun users(): List<UserProfile> =
        client.send<ListEnvelope<UserProfile>>(ApiRequest.get("users")).data

    override suspend fun memberships(userId: String): List<MembershipSummary> =
        client.send<ListEnvelope<MembershipSummary>>(ApiRequest.get("users/$userId/memberships")).data

    override suspend fun replaceMemberships(
        userId: String,
        memberships: List<MembershipInput>,
    ): List<MembershipSummary> =
        client
            .send<ListEnvelope<MembershipSummary>>(
                ApiRequest.put("users/$userId/memberships", body = membershipsBody(memberships).asBody()),
            ).data

    override suspend fun invitations(): List<Invitation> =
        client.send<ListEnvelope<Invitation>>(ApiRequest.get("invitations")).data

    override suspend fun invite(input: CreateInvitationInput): Invitation =
        client.send(ApiRequest.post("invitations", body = input.toJson().asBody()))

    override suspend fun revokeInvitation(id: String) = client.sendVoid(ApiRequest.delete("invitations/$id"))
}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))

/**
 * Mock kullanıcılar: üç profilli personel + profilsiz iki kişi (oturumdaki yönetici ve
 * resepsiyon). Personel oluşturma ekranı adayları bu listeden, profili olanları düşerek
 * çıkarıyor.
 *
 * Üyelikler **yazılabilir** (A7.5) ve sunucunun iki sessiz kuralını taklit eder: kapsam
 * (kiracı rolü şube almaz, şube rolü şube ister → 400) ve son sahip kaldırılamaz (409).
 */
class MockUsersService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
) : UsersService {
    var failing: Boolean = false

    private val memberships: MutableMap<String, List<MembershipSummary>> =
        ALL.associate { it.id to it.memberships }.toMutableMap()
    private val invitations: MutableList<Invitation> =
        mutableListOf(
            Invitation(
                id = "inv-1",
                email = "yeni@klinik.com",
                roleKey = "practitioner",
                branchId = MockIds.BRANCH_BODRUM,
                expiresAt = Instant.now().plus(Duration.ofDays(INVITE_DAYS - 1)),
                createdAt = Instant.now().minus(Duration.ofDays(1)),
            ),
        )
    private var idCounter = 0

    override suspend fun users(): List<UserProfile> {
        settle()
        return ALL.map { it.copy(memberships = memberships[it.id].orEmpty()) }
    }

    override suspend fun memberships(userId: String): List<MembershipSummary> {
        settle()
        return memberships[userId].orEmpty()
    }

    override suspend fun replaceMemberships(
        userId: String,
        memberships: List<MembershipInput>,
    ): List<MembershipSummary> {
        settle()
        memberships.forEach { input ->
            val scope = RoleDefinitions.of(input.roleKey)?.scope
            if ((scope == RoleScope.Branch) == (input.branchId == null)) {
                val message =
                    if (input.branchId == null) {
                        "Şube kapsamlı rol için zorunlu"
                    } else {
                        "Kiracı kapsamlı rol için gönderilmemeli"
                    }
                throw MockErrors.validation("branchId", message)
            }
        }
        val ownerElsewhere =
            this.memberships.filterKeys { it != userId }.values.flatten().any { it.roleKey == OWNER }
        val removesOwner =
            this.memberships[userId].orEmpty().any { it.roleKey == OWNER } && memberships.none { it.roleKey == OWNER }
        if (removesOwner && !ownerElsewhere) {
            throw MockErrors.conflict("Kliniğin son işletme sahibi kaldırılamaz")
        }
        val updated =
            memberships.map {
                idCounter += 1
                MembershipSummary(
                    id = "m-new-$idCounter",
                    branchId = it.branchId,
                    roleKey = it.roleKey,
                    roleName = RoleNames.turkish(it.roleKey),
                )
            }
        this.memberships[userId] = updated
        return updated
    }

    override suspend fun invitations(): List<Invitation> {
        settle()
        return invitations.toList()
    }

    override suspend fun invite(input: CreateInvitationInput): Invitation {
        settle()
        idCounter += 1
        val created =
            Invitation(
                id = "inv-new-$idCounter",
                email = input.email,
                roleKey = input.roleKey,
                branchId = input.branchId,
                expiresAt = Instant.now().plus(Duration.ofDays(INVITE_DAYS)),
                createdAt = Instant.now(),
            )
        invitations.add(0, created)
        return created
    }

    override suspend fun revokeInvitation(id: String) {
        settle()
        invitations.removeAll { it.id == id }
    }

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    companion object {
        val ALL: List<UserProfile> =
            listOf(
                user(MockIds.USER_MANAGER, "Ayşe Yılmaz", "ayse.yilmaz@klinik.com", "manager", "Yönetici"),
                user(MockIds.USER_DERYA, "Derya Aksoy", "derya.aksoy@klinik.com", "practitioner", "Uygulayıcı"),
                user(MockIds.USER_MERVE, "Merve Tunç", "merve.tunc@klinik.com", "practitioner", "Uygulayıcı"),
                user(MockIds.USER_ONUR, "Onur Bayrak", "onur.bayrak@klinik.com", "practitioner", "Uygulayıcı"),
                user(MockIds.USER_RECEPTION, "Elif Kaya", "elif.kaya@klinik.com", "receptionist", "Resepsiyon"),
            )

        private const val OWNER = "owner"
        private const val INVITE_DAYS = 7L
        private const val MIN_LATENCY_MILLIS = 120L
        private const val MAX_LATENCY_MILLIS = 400L

        private fun user(
            id: String,
            fullName: String,
            email: String,
            roleKey: String,
            roleName: String,
        ) = UserProfile(
            id = id,
            email = email,
            fullName = fullName,
            locale = "tr-TR",
            phoneVerified = true,
            createdAt = "2026-05-02T09:30:00.000Z",
            memberships =
                listOf(
                    MembershipSummary(
                        id = "m-$id",
                        branchId = MockIds.BRANCH_NISANTASI,
                        roleKey = roleKey,
                        roleName = roleName,
                    ),
                ),
        )
    }
}
