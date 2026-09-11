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
