package com.klinara.android.services.staff

import com.klinara.android.services.auth.MembershipSummary
import com.klinara.android.services.auth.UserProfile
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.ListEnvelope
import kotlinx.coroutines.delay
import kotlin.random.Random

/**
 * Kiracının kullanıcıları — `GET users`, `user:read`.
 *
 * A7.2'de geldi, A2.1'de değil: iOS'ta da tek çağıranı personel oluşturma (profil var olan
 * bir kullanıcıya bağlanıyor). Kabuk ve profil `AuthService.me()` ile yetiniyor. Davet
 * (`POST invitations`) bu istemcide yok — iOS'ta da yok.
 */
interface UsersService {
    suspend fun users(): List<UserProfile>
}

class LiveUsersService internal constructor(
    private val client: ApiClient,
) : UsersService {
    override suspend fun users(): List<UserProfile> =
        client.send<ListEnvelope<UserProfile>>(ApiRequest.get("users")).data
}

/**
 * Mock kullanıcılar: üç profilli personel + profilsiz iki kişi (oturumdaki yönetici ve
 * resepsiyon). Personel oluşturma ekranı adayları bu listeden, profili olanları düşerek
 * çıkarıyor.
 */
class MockUsersService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
) : UsersService {
    var failing: Boolean = false

    override suspend fun users(): List<UserProfile> {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
        return ALL
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
