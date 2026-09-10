package com.klinara.android.services.auth

import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant

// Bu dosyadaki tipler `apps/api/src/modules/identity/dto/` altındaki gerçek NestJS
// DTO'larından birebir türetilmiştir. Alan adları sunucudakiyle aynıdır; canlı servise
// geçildiğinde ek eşleme olmadan çözülür.

/** Giriş üç durumdan biriyle biter. */
@Serializable
enum class LoginStatus {
    @SerialName("authenticated")
    AUTHENTICATED,

    @SerialName("tenant_selection_required")
    TENANT_SELECTION_REQUIRED,

    @SerialName("mfa_required")
    MFA_REQUIRED,
}

/** Kullanıcı birden çok klinikte üyeyse seçim listesi. */
@Serializable
data class TenantOption(
    val id: String,
    val slug: String,
    val name: String,
    val roles: List<String> = emptyList(),
)

@Serializable
data class MfaChallenge(
    /**
     * Kullanıcı TOTP kurulumunu tamamlamış mı. `false` + `MFA_REQUIRED` kombinasyonu,
     * kiracı politikasının 2FA'yı zorunlu kıldığı ama kullanıcının henüz kurmadığı
     * anlamına gelir — kurulum ekranı gerekir (yumurta-tavuk akışı, §4.7).
     */
    val configured: Boolean,
    /** Örn. `["totp", "backup_code"]`. */
    val methods: List<String> = emptyList(),
) {
    val allowsBackupCode: Boolean get() = methods.contains("backup_code")
}

@Serializable
data class SelectedTenant(val id: String)

/** `tokens` **yalnız** `AUTHENTICATED` durumunda doludur. */
@Serializable
data class LoginResponse(
    val status: LoginStatus,
    val tokens: AuthTokens? = null,
    /** Ara token — kiracı seçimi ve 2FA adımlarında taşınır. */
    val challengeToken: String? = null,
    val tenants: List<TenantOption>? = null,
    val mfa: MfaChallenge? = null,
    val tenant: SelectedTenant? = null,
)

/**
 * Giriş yanıtının **tip güvenli** hâli.
 *
 * `LoginResponse` ekranlarda doğrudan tüketilmez: opsiyonel `tokens` alanı, yarım
 * kalmış bir oturumun yanlışlıkla tam yetkili sayılmasına kapı bırakır. Bu sealed
 * hiyerarşide yarım oturumun token'ı **tip olarak yoktur**.
 */
sealed interface LoginOutcome {
    data class Success(val tokens: AuthTokens) : LoginOutcome

    data class NeedsTenantSelection(
        val challengeToken: String,
        val tenants: List<TenantOption>,
    ) : LoginOutcome

    data class NeedsMfa(
        val challengeToken: String,
        val challenge: MfaChallenge,
    ) : LoginOutcome
}

/**
 * Sunucu sözleşmesini sealed hiyerarşiye indirger. Beklenen alanlar eksikse sessizce
 * yanlış bir duruma düşmek yerine hata fırlatır.
 */
fun LoginResponse.outcome(): LoginOutcome =
    when (status) {
        LoginStatus.AUTHENTICATED ->
            LoginOutcome.Success(
                tokens ?: throw ApiError.MalformedResponse("authenticated yanıtında tokens yok"),
            )

        LoginStatus.TENANT_SELECTION_REQUIRED -> {
            val token = challengeToken
            val options = tenants
            if (token == null || options.isNullOrEmpty()) {
                throw ApiError.MalformedResponse("tenant_selection_required yanıtı eksik")
            }
            LoginOutcome.NeedsTenantSelection(token, options)
        }

        LoginStatus.MFA_REQUIRED -> {
            val token = challengeToken
            val challenge = mfa
            if (token == null || challenge == null) {
                throw ApiError.MalformedResponse("mfa_required yanıtı eksik")
            }
            LoginOutcome.NeedsMfa(token, challenge)
        }
    }

/** `branchId` null ise üyelik kiracı kapsamlıdır. */
@Serializable
data class MembershipSummary(
    val id: String,
    val branchId: String? = null,
    val roleKey: String,
    val roleName: String,
)

@Serializable
data class UserProfile(
    val id: String,
    val email: String,
    val fullName: String,
    val locale: String = "tr",
    val isActive: Boolean = true,
    val phone: String? = null,
    /** `false` ise numara giriş tanımlayıcısı **değildir** — doğrulanması gerekir. */
    val phoneVerified: Boolean = false,
    /** Davet bekleyen hesapta `false`. */
    val hasPassword: Boolean = true,
    val lastLoginAt: String? = null,
    val createdAt: String = "",
    val memberships: List<MembershipSummary> = emptyList(),
)

/**
 * `GET /me` — istemcinin izin aynasının kaynağı.
 *
 * `permissions` sunucunun kararıdır; istemci onu yalnız YANSITIR (§5.7).
 */
@Serializable
data class MeResponse(
    val user: UserProfile,
    val tenantId: String,
    val roles: List<String> = emptyList(),
    val permissions: List<String> = emptyList(),
    val branchIds: List<String> = emptyList(),
    /** true ise kullanıcı kiracının TÜM şubelerini görür. */
    val tenantWide: Boolean = false,
)

@Serializable
data class BranchSummary(
    val id: String,
    val name: String,
    /** IANA dilim adı; `BranchClock` bunu kullanır. */
    val timezone: String = "Europe/Istanbul",
    val address: String? = null,
    val isActive: Boolean = true,
)

/**
 * `GET auth/2fa` — iki adımlı doğrulama durumu.
 *
 * **`/me` bu bilgiyi TAŞIMIYOR** (doğrulandı: `MeResponseDto` böyle bir alan içermiyor),
 * bu yüzden profil ekranı ayrı bir çağrı yapıyor. Yeni bir uç eklenmedi; uç zaten vardı,
 * yalnız hiçbir istemci çağırmıyordu.
 */
@Serializable
data class TotpStatus(
    val enabled: Boolean = false,
    val backupCodesRemaining: Int = 0,
)

/**
 * `GET auth/passkeys` — kullanıcının kayıtlı passkey'lerinden biri.
 *
 * Liste A1.5'ten BAĞIMSIZ olarak anlamlıdır: Credential Manager gerekmez, düz bir API
 * çağrısıdır ve iOS'ta ya da web'de kaydedilmiş anahtarlar burada görünür.
 */
@Serializable
data class PasskeySummary(
    val id: String,
    val deviceLabel: String,
    /** Bulut senkronlu bir anahtar mı — cihaz kaybında kurtarılabilir demektir. */
    val backedUp: Boolean = false,
    val transports: List<String> = emptyList(),
    val lastUsedAt: String? = null,
    val createdAt: String = "",
)

@Serializable
data class TotpSetup(
    val secret: String,
    val otpauthUri: String,
)

@Serializable
data class PhoneVerificationStarted(
    val phone: String,
    /** Geri sayım BUNDAN türetilir, istemci sayacından değil. */
    @Serializable(with = InstantSerializer::class) val expiresAt: Instant,
    val delivered: Boolean = true,
)

@Serializable
data class PhoneVerified(
    val phone: String,
    @Serializable(with = InstantSerializer::class) val verifiedAt: Instant,
)
