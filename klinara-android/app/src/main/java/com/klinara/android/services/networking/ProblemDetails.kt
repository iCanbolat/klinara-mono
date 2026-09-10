package com.klinara.android.services.networking

import com.klinara.android.services.contracts.ApiErrorCode
import kotlinx.serialization.Serializable

/** Alan bazlı doğrulama hatası: `path` istek gövdesindeki yol. */
@Serializable
data class FieldError(
    val path: String,
    val message: String,
)

/** Çakışan randevu bloğu — `SLOT_CONFLICT` uzantısı. */
@Serializable
data class SlotConflict(
    val appointmentId: String? = null,
    val staffProfileId: String? = null,
    @Serializable(with = InstantSerializer::class) val startsAt: java.time.Instant? = null,
    @Serializable(with = InstantSerializer::class) val endsAt: java.time.Instant? = null,
)

/** Sunucunun önerdiği alternatif slot. */
@Serializable
data class SlotSuggestion(
    @Serializable(with = InstantSerializer::class) val startsAt: java.time.Instant,
    @Serializable(with = InstantSerializer::class) val endsAt: java.time.Instant,
    val staffProfileId: String? = null,
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
