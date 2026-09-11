package com.klinara.android.services.packages

import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.time.Instant

// Kaynak: `apps/api/src/modules/packages/dto/package-operation.dto.ts`.

/**
 * `PackageEntitlementDto` — randevu ekranının paket seçimi için kullanılabilir hak.
 *
 * Sunucu yalnız **aktif, süresi dolmamış ve kalanı olan** kalemleri döner; istemcinin
 * ayrıca elemesi gerekmez. Liste kimliği KALEM kimliğidir: bir müşteride aynı hizmetin iki
 * ayrı paketten hakkı olabilir.
 */
@Serializable
data class PackageEntitlement(
    val customerPackageItemId: String,
    val customerPackageId: String,
    val packageName: String = "",
    val serviceId: String,
    val serviceName: String = "",
    val remainingSessions: Int = 0,
    @Serializable(with = InstantSerializer::class)
    val expiresAt: Instant? = null,
    val branchId: String,
)

/** Randevunun bir hizmet kalemini bir paket kalemine bağlar. */
data class ConsumePackageLineInput(
    /** Randevunun hizmet satırı (`AppointmentServiceLine.id`). */
    val appointmentServiceId: String,
    val customerPackageItemId: String,
)

/** `ConsumePackageDto`. */
data class ConsumePackageInput(
    val lines: List<ConsumePackageLineInput>,
) {
    fun toJson(): JsonObject =
        buildJsonObject {
            putJsonArray("lines") {
                lines.forEach { line ->
                    addJsonObject {
                        put("appointmentServiceId", line.appointmentServiceId)
                        put("customerPackageItemId", line.customerPackageItemId)
                    }
                }
            }
        }
}

/**
 * `ConsumePackageResultDto`.
 *
 * [consumed] randevu **henüz `completed` değilse 0'dır ve bu bir hata DEĞİL**: bağlama
 * yapıldı, düşme randevu tamamlandığında aynı transaction içinde kendiliğinden olacak.
 */
@Serializable
data class ConsumePackageResult(
    val bound: Int = 0,
    val consumed: Int = 0,
)

// --- A5.3: düzeltme, iade, devir ---
//
// Sunucu sözleşmesi (`package-operations.controller.ts`): üçü de `If-Match` İSTER; `refund`
// ve `transfer` ayrıca `Idempotency-Key` alır, `adjust` ALMAZ. İlki "bayat durum üzerinde
// işlem yaptın"ı, ikincisi "aynı isteği tekrar gönderdin"i durdurur — biri diğerinin
// yerini tutmaz. (iOS modelindeki "üçü de ikisini ister" notu `adjust` için yanlıştı.)

/** Gerekçe kuralı — sunucudaki `@MinLength(5) @MaxLength(500)` aynası. */
object OperationReason {
    const val MIN_LENGTH = 5
    const val MAX_LENGTH = 500

    fun isValid(reason: String): Boolean = reason.trim().length in MIN_LENGTH..MAX_LENGTH
}

/** Pozitif = hak ekle, negatif = hak düş. **Sıfır olamaz.** */
data class AdjustItemInput(
    val customerPackageItemId: String,
    val delta: Int,
)

/** `AdjustPackageDto` — gerekçe ZORUNLU; sunucu ve veritabanı da zorluyor. */
data class AdjustPackageInput(
    val items: List<AdjustItemInput>,
    val reason: String,
) {
    /** Kullanıcıya `400` yerine pasif bir "Uygula" düğmesi göstermek için. */
    val isValid: Boolean
        get() = items.isNotEmpty() && items.all { it.delta != 0 } && OperationReason.isValid(reason)

    fun toJson(): JsonObject =
        buildJsonObject {
            putJsonArray("items") {
                items.forEach { item ->
                    addJsonObject {
                        put("customerPackageItemId", item.customerPackageItemId)
                        put("delta", item.delta)
                    }
                }
            }
            put("reason", reason.trim())
        }
}

/** İade ya da devir için kalem başına seans sayısı (en az 1). */
data class SessionsItemInput(
    val customerPackageItemId: String,
    val sessions: Int,
)

/**
 * `RefundPackageDto`. [items] `null` ise TÜM kalan hak iade edilir — tam iadede liste
 * gönderilmez, sunucu kendisi hesaplar ve arada yarış olmaz.
 */
data class RefundPackageInput(
    val items: List<SessionsItemInput>?,
    val reason: String,
) {
    val isValid: Boolean
        get() =
            (items == null || (items.isNotEmpty() && items.all { it.sessions > 0 })) &&
                OperationReason.isValid(reason)

    fun toJson(): JsonObject =
        buildJsonObject {
            items?.let { putSessions(it) }
            put("reason", reason.trim())
        }
}

/**
 * `RefundResultDto`.
 *
 * **Kasa hareketi yoktur.** Tutar satış anındaki tahsisten hesaplanır ve yükümlülük
 * `pending` yazılır; tahsilat tarafı Faz A6'da bağlanacak.
 */
@Serializable
data class RefundResult(
    val refundedSessions: Int = 0,
    val refundAmountMinor: Long = 0,
    /** `pending` ya da `settled`. */
    val settlementStatus: String = "pending",
)

/** `TransferPackageDto` — [items] `null` ise tüm kalan hak devredilir. */
data class TransferPackageInput(
    val targetCustomerId: String,
    val items: List<SessionsItemInput>?,
    val reason: String,
) {
    val isValid: Boolean
        get() =
            targetCustomerId.isNotEmpty() &&
                (items == null || (items.isNotEmpty() && items.all { it.sessions > 0 })) &&
                OperationReason.isValid(reason)

    fun toJson(): JsonObject =
        buildJsonObject {
            put("targetCustomerId", targetCustomerId)
            items?.let { putSessions(it) }
            put("reason", reason.trim())
        }
}

private fun kotlinx.serialization.json.JsonObjectBuilder.putSessions(items: List<SessionsItemInput>) {
    putJsonArray("items") {
        items.forEach { item ->
            addJsonObject {
                put("customerPackageItemId", item.customerPackageItemId)
                put("sessions", item.sessions)
            }
        }
    }
}
