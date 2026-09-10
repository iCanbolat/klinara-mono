package com.klinara.android.services.auth

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.contracts.RolePermissions
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.mock.MockScenario
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.ProblemDetails
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.jsonObject
import java.time.Instant
import kotlin.random.Random

/**
 * Sunucusuz giriş akışı.
 *
 * **Yanıtlar gerçek JSON'dur ve üretim çözümleyicisiyle (`KlinaraJson`) çözülür.**
 * Elle kurulmuş nesneler döndürmek, bir sözleşme kaymasını mock modda gizlerdi;
 * böyleyken kayma mock'u da kırar.
 *
 * Gecikme birim testlerinde **tohumlanmış** rastgeledir: iOS'un tohumsuz sürümü yapı
 * gereği flaky test üretiyordu.
 */
class MockAuthService(
    var scenario: MockScenario = MockScenario.PasswordThenTotp,
    private val random: Random = Random.Default,
    private val latencyEnabled: Boolean = true,
) : AuthService {
    /** `verifyPhone` başarılı olunca true'ya döner — akış ilerleyebilsin. */
    private var phoneVerified: Boolean = scenario != MockScenario.UnverifiedPhone

    fun reset() {
        phoneVerified = scenario != MockScenario.UnverifiedPhone
    }

    // ------------------------------------------------------------------ giriş

    override suspend fun login(
        email: String?,
        phone: String?,
        password: String,
        deviceLabel: String,
    ): LoginResponse {
        simulateLatency()
        failureForCurrentScenario()?.let { throw it }

        val fixture =
            when (scenario) {
                MockScenario.MultiTenant -> "auth/login-tenant-selection.json"
                MockScenario.PasswordThenTotp -> "auth/login-mfa-configured.json"
                MockScenario.MfaRequiredNotConfigured -> "auth/login-mfa-not-configured.json"
                else -> "auth/login-authenticated.json"
            }
        return decode(fixture)
    }

    override suspend fun selectTenant(
        challengeToken: String,
        tenantId: String,
    ): LoginResponse {
        simulateLatency()
        return decode("auth/login-authenticated.json")
    }

    override suspend fun verifyMfa(
        challengeToken: String,
        code: String,
        deviceLabel: String,
    ): LoginResponse {
        simulateLatency()
        transportFailure()?.let { throw it }
        // Yedek kod tire içerir; TOTP tam altı hanedir. ALWAYS_WRONG hata yolunu sürmek için.
        val isBackupCode = code.contains('-')
        val isTotp = code.length == TOTP_LENGTH && code.all(Char::isDigit)
        if (code == ALWAYS_WRONG_CODE || (!isBackupCode && !isTotp)) {
            throw problem("auth/problem-mfa-invalid.json")
        }
        return decode("auth/login-authenticated.json")
    }

    override suspend fun totpSetup(challengeToken: String): TotpSetup {
        simulateLatency()
        return decode("auth/totp-setup.json")
    }

    override suspend fun totpEnable(
        challengeToken: String,
        code: String,
    ): List<String> {
        simulateLatency()
        if (code == ALWAYS_WRONG_CODE) throw problem("auth/problem-mfa-invalid.json")
        return KlinaraJson
            .decodeFromString<BackupCodes>(Fixtures.read("auth/backup-codes.json"))
            .backupCodes
    }

    // ------------------------------------------------------------------ profil

    override suspend fun me(): MeResponse {
        simulateLatency()
        transportFailure()?.let { throw it }

        val raw = KlinaraJson.parseToJsonElement(Fixtures.read("auth/me.json")).jsonObject
        val roleKey = scenario.roleKey
        val multipleBranches = scenario == MockScenario.MultiBranch

        // İzinler fixture'da TUTULMAZ: üretilmiş RolePermissions'tan gelir. Elle tutulan
        // bir liste iOS'ta bir kez saptı ve Faz 6 ekranları sessizce erişilemez oldu.
        val patched =
            JsonObject(
                raw.toMutableMap().apply {
                    put("roles", buildJsonArray { add(JsonPrimitive(roleKey)) })
                    put(
                        "permissions",
                        JsonArray(RolePermissions.forRole(roleKey).map(::JsonPrimitive)),
                    )
                    put("branchIds", JsonArray(branchIds(multipleBranches).map(::JsonPrimitive)))
                    put("user", patchedUser(raw["user"]!!.jsonObject, roleKey, multipleBranches))
                },
            )

        return KlinaraJson.decodeFromString(KlinaraJson.encodeToString(JsonObject.serializer(), patched))
    }

    override suspend fun branches(): List<BranchSummary> {
        simulateLatency()
        transportFailure()?.let { throw it }
        val fixture =
            if (scenario == MockScenario.MultiBranch) "auth/branches-many.json" else "auth/branches-one.json"
        return KlinaraJson
            .decodeFromString<ListEnvelope<BranchSummary>>(Fixtures.read(fixture))
            .data
    }

    // ------------------------------------------------------------------ telefon

    override suspend fun startPhoneVerification(phone: String): PhoneVerificationStarted {
        simulateLatency()
        return PhoneVerificationStarted(
            phone = phone,
            expiresAt = Instant.now().plusSeconds(CODE_TTL_SECONDS),
            delivered = true,
        )
    }

    override suspend fun verifyPhone(code: String): PhoneVerified {
        simulateLatency()
        if (code == ALWAYS_WRONG_CODE) throw problem("auth/problem-verification-failed.json")
        phoneVerified = true
        return PhoneVerified(phone = MOCK_PHONE, verifiedAt = Instant.now())
    }

    // ------------------------------------------------------------------ diğer

    /** ASLA hata fırlatmaz — sunucunun hesap sayımını önleyen sözleşmesinin aynısı. */
    override suspend fun forgotPassword(email: String) {
        simulateLatency()
    }

    override suspend fun logout() {
        simulateLatency()
    }

    override suspend fun passkeyAssertionOptions(): String = error("Passkey mock modda desteklenmiyor (A1.5)")

    override suspend fun passkeyVerify(
        responseJson: String,
        deviceLabel: String,
    ): LoginResponse = error("Passkey mock modda desteklenmiyor (A1.5)")

    override suspend fun passkeyRegistrationOptions(): String = error("Passkey mock modda desteklenmiyor (A1.5)")

    override suspend fun registerPasskey(
        responseJson: String,
        deviceLabel: String,
    ) = error("Passkey mock modda desteklenmiyor (A1.5)")

    // ------------------------------------------------------------------ iç

    /**
     * Girişe özgü hata senaryoları. `WrongPassword`, `AccountLocked` ve `RateLimited`
     * yalnız kimlik doğrulamada anlamlıdır; oturum açıldıktan sonraki çağrıları
     * etkilemezler.
     */
    private fun failureForCurrentScenario(): ApiError? =
        when (scenario) {
            MockScenario.WrongPassword -> problem("auth/problem-invalid-credentials.json")
            MockScenario.AccountLocked -> problem("auth/problem-account-locked.json")
            MockScenario.RateLimited -> problem("auth/problem-rate-limited.json")
            else -> transportFailure()
        }

    /**
     * Taşıma katmanı hatası HER çağrıyı keser.
     *
     * Yalnız `login`'i kesmek gerçekçi değildi: bir ağ kesintisi oturum geri yükleme
     * sırasındaki `me()` çağrısını da düşürür ve açılış yolunun o hataya dayanıklı
     * olduğunu ancak böyle test edebiliriz.
     */
    private fun transportFailure(): ApiError? =
        ApiError.Network().takeIf { scenario == MockScenario.NetworkError }

    private fun problem(path: String): ApiError.Problem =
        ApiError.Problem(KlinaraJson.decodeFromString<ProblemDetails>(Fixtures.read(path)))

    private inline fun <reified T> decode(path: String): T = KlinaraJson.decodeFromString(Fixtures.read(path))

    private fun branchIds(multiple: Boolean) =
        if (multiple) {
            listOf(MockIds.BRANCH_NISANTASI, MockIds.BRANCH_BODRUM)
        } else {
            listOf(MockIds.BRANCH_NISANTASI)
        }

    private fun patchedUser(
        user: JsonObject,
        roleKey: String,
        multipleBranches: Boolean,
    ): JsonObject {
        val roleName = if (roleKey == "practitioner") "Uygulayıcı" else "Şube Yöneticisi"
        val memberships =
            JsonArray(
                branchIds(multipleBranches).mapIndexed { index, branchId ->
                    JsonObject(
                        mapOf(
                            "id" to JsonPrimitive("m${index + 1}"),
                            "branchId" to JsonPrimitive(branchId),
                            "roleKey" to JsonPrimitive(roleKey),
                            "roleName" to JsonPrimitive(roleName),
                        ),
                    )
                },
            )
        return JsonObject(
            user.toMutableMap().apply {
                put("phoneVerified", JsonPrimitive(phoneVerified))
                put("memberships", memberships)
            },
        )
    }

    private suspend fun simulateLatency() {
        if (!latencyEnabled) return
        delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
    }

    @kotlinx.serialization.Serializable
    private data class BackupCodes(val backupCodes: List<String> = emptyList())

    private companion object {
        const val TOTP_LENGTH = 6

        /** Hata yolunu sürmek için sabit, her zaman yanlış kod. */
        const val ALWAYS_WRONG_CODE = "000000"

        const val CODE_TTL_SECONDS = 300L
        const val MOCK_PHONE = "+905321234567"

        const val MIN_LATENCY_MILLIS = 200L
        const val MAX_LATENCY_MILLIS = 800L
    }
}
