package com.klinara.android.services.networking

import com.klinara.android.services.contracts.ApiErrorCode
import kotlinx.serialization.Serializable

/** Alan bazlı doğrulama hatası: `path` istek gövdesindeki yol. */
@Serializable
data class FieldError(
    val path: String,
    val message: String,
)

/**
 * Çakışan randevu bloğu — `SLOT_CONFLICT` uzantısı.
 *
 * Alan adları `appointments.service.ts:844` ile birebir: `resourceId`, `from`, `to`.
 * A0.4'te bunlar `staffProfileId` / `startsAt` / `endsAt` olarak yazılmıştı —
 * `API_DEVELOPMENT.md` §5.4'ün ÖRNEĞİ öyle diyor ama sunucu kodu öyle demiyor.
 * Hepsi nullable olduğu için çözümleme çökmüyordu, yalnız **sessizce boş** kalıyordu:
 * çakışma sayfası "dolu olan" satırını hiç çizemezdi ve bunun sebebi görünmezdi.
 *
 * [from] ve [to] TAMPONLARI İÇERİR — kullanıcının gördüğü saatten geniştir
 * (tamponlar `resource_bookings.time_range`'te yaşar, `appointments`'ta değil).
 */
@Serializable
data class SlotConflict(
    /** Bugün her zaman `"staff"`; sunucu ileride oda/cihaz da tutabilir. */
    val resourceType: String? = null,
    val resourceId: String? = null,
    val appointmentId: String? = null,
    @Serializable(with = InstantSerializer::class) val from: java.time.Instant? = null,
    @Serializable(with = InstantSerializer::class) val to: java.time.Instant? = null,
)

/**
 * Sunucunun önerdiği alternatif slot. Uygunluk motorundan gelir, en fazla 3 tane.
 *
 * [staffProfileIds] bir LİSTEDİR (aday personeller), tekil bir kimlik değil.
 */
@Serializable
data class SlotSuggestion(
    @Serializable(with = InstantSerializer::class) val startsAt: java.time.Instant,
    @Serializable(with = InstantSerializer::class) val endsAt: java.time.Instant,
    val staffProfileIds: List<String> = emptyList(),
)

/**
 * RFC 9457 `application/problem+json` gövdesi.
 *
 * `conflicts` ve `suggestions` belge KÖKÜNDE duran uzantı alanlarıdır — sunucu
 * bunları `SLOT_CONFLICT` yanıtında gönderiyor.
 */
@Serializable
data class ProblemDetails(
    val code: ApiErrorCode = ApiErrorCode.UNKNOWN,
    val title: String = "",
    val detail: String? = null,
    val status: Int = 0,
    val requestId: String? = null,
    val errors: List<FieldError>? = null,
    val conflicts: List<SlotConflict>? = null,
    val suggestions: List<SlotSuggestion>? = null,
)
