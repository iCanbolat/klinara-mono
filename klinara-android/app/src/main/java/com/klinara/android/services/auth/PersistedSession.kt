package com.klinara.android.services.auth

import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.Serializable
import java.time.Instant

/**
 * Diskte şifreli duran oturum. iOS `TokenStore.Persisted` ile birebir alanlar.
 *
 * Burada **yalnız oturum materyali** vardır: kullanıcı adı, telefon, sağlık verisi
 * hiçbir koşulda buraya yazılmaz (§7.9).
 */
@Serializable
data class PersistedSession(
    val accessToken: String,
    val refreshToken: String,
    @Serializable(with = InstantSerializer::class) val expiresAt: Instant,
    val tenantId: String? = null,
    val branchId: String? = null,
)

/** Sunucudan gelen token çifti. */
@Serializable
data class AuthTokens(
    val accessToken: String,
    val refreshToken: String,
    val tokenType: String = "Bearer",
    /** Saniye. Sunucu 900 gönderiyor. */
    val expiresIn: Long,
)
