package com.klinara.android.services.catalog

import com.klinara.android.services.crm.Patch
import com.klinara.android.services.crm.putPatchElement
import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.time.Instant

// Bu dosyadaki tipler `apps/api/src/modules/catalog/dto/catalog.dto.ts` içindeki
// DTO'lardan birebir türetilmiştir; alan adları sunucudakiyle aynıdır. Para `Long` minor
// unit'tir (§5.8). Katalog uçlarında If-Match / sürüm YOK — son yazan kazanır.

/** `ServiceCategoryResponseDto` — hizmetlerin gruplandığı başlık. */
@Serializable
data class ServiceCategory(
    val id: String,
    val tenantId: String = "",
    val slug: String,
    val name: String,
    val sortOrder: Int = 0,
    val isActive: Boolean = true,
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
)

/**
 * Hizmet — `ServiceResponseDto`.
 *
 * [branchOverrides] şube başına süre/fiyat farklarını taşıyor: aynı hizmet Nişantaşı'nda
 * 60 dk 900 ₺, Bodrum'da 75 dk 1.100 ₺ olabilir. Rezervasyon formu **şubenin geçerli
 * değerini** göstermeli; kiracı genelini göstermek yanlış bir süre ve yanlış bir tutar
 * demek olurdu.
 */
@Serializable
data class ClinicService(
    val id: String,
    val tenantId: String = "",
    val categoryId: String,
    val slug: String = "",
    val name: String,
    val description: String? = null,
    val durationMinutes: Int = 0,
    val bufferBeforeMinutes: Int = 0,
    val bufferAfterMinutes: Int = 0,
    val priceMinor: Long = 0,
    val vatRateBasisPoints: Int = 0,
    val calendarColor: String? = null,
    val isOnlineBookable: Boolean = true,
    val isActive: Boolean = true,
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
    val branchOverrides: List<BranchServiceOverride> = emptyList(),
) {
    /**
     * Şubede geçerli değerler. Override alanı `null` ise kiracı geneli — `null` "sıfır"
     * değil "miras al" demektir.
     */
    fun effective(branchId: String?): Effective {
        val override = branchOverrides.firstOrNull { it.branchId == branchId }
        return Effective(
            durationMinutes = override?.durationMinutes ?: durationMinutes,
            bufferBeforeMinutes = override?.bufferBeforeMinutes ?: bufferBeforeMinutes,
            bufferAfterMinutes = override?.bufferAfterMinutes ?: bufferAfterMinutes,
            priceMinor = override?.priceMinor ?: priceMinor,
            isOnlineBookable = override?.isOnlineBookable ?: isOnlineBookable,
            isActive = isActive && override?.isActive != false,
            isOverridden = override != null,
        )
    }

    data class Effective(
        val durationMinutes: Int,
        val priceMinor: Long,
        val bufferBeforeMinutes: Int = 0,
        val bufferAfterMinutes: Int = 0,
        val isOnlineBookable: Boolean = true,
        val isActive: Boolean = true,
        /** Şubenin bir override satırı var mı — listede "Şubeye özel" rozeti. */
        val isOverridden: Boolean = false,
    ) {
        /** Takvimde bloke edilen toplam: hazırlık + işlem + temizlik. */
        val occupiedMinutes: Int get() = bufferBeforeMinutes + durationMinutes + bufferAfterMinutes
    }
}

/** `BranchServiceOverrideResponseDto`. Her değer alanı `null` = hizmetin kendi değeri. */
@Serializable
data class BranchServiceOverride(
    val id: String = "",
    val serviceId: String = "",
    val branchId: String,
    val durationMinutes: Int? = null,
    val bufferBeforeMinutes: Int? = null,
    val bufferAfterMinutes: Int? = null,
    val priceMinor: Long? = null,
    val vatRateBasisPoints: Int? = null,
    val isOnlineBookable: Boolean? = null,
    val isActive: Boolean? = null,
) {
    fun toInput(): BranchServiceOverrideInput =
        BranchServiceOverrideInput(
            branchId = branchId,
            durationMinutes = durationMinutes,
            bufferBeforeMinutes = bufferBeforeMinutes,
            bufferAfterMinutes = bufferAfterMinutes,
            priceMinor = priceMinor,
            vatRateBasisPoints = vatRateBasisPoints,
            isOnlineBookable = isOnlineBookable,
            isActive = isActive,
        )
}

/**
 * `BranchServiceOverrideInputDto`.
 *
 * Sunucu değer alanlarının **en az birini** istiyor (`branch_service_overrides_any_override`);
 * [isEmpty] olan bir girdi gönderilmez — "bu şubede fark yok" demenin yolu satırı listeden
 * çıkarmak, çünkü liste tam değiştirme ile yazılıyor.
 */
data class BranchServiceOverrideInput(
    val branchId: String,
    val durationMinutes: Int? = null,
    val bufferBeforeMinutes: Int? = null,
    val bufferAfterMinutes: Int? = null,
    val priceMinor: Long? = null,
    val vatRateBasisPoints: Int? = null,
    val isOnlineBookable: Boolean? = null,
    val isActive: Boolean? = null,
) {
    val isEmpty: Boolean
        get() =
            durationMinutes == null && bufferBeforeMinutes == null && bufferAfterMinutes == null &&
                priceMinor == null && vatRateBasisPoints == null && isOnlineBookable == null && isActive == null
}

/** `CreateServiceCategoryDto`. */
data class CreateServiceCategoryInput(
    val slug: String,
    val name: String,
    val sortOrder: Int? = null,
    val isActive: Boolean? = null,
) {
    fun toJson(): JsonObject =
        buildJsonObject {
            put("slug", slug)
            put("name", name)
            sortOrder?.let { put("sortOrder", it) }
            isActive?.let { put("isActive", it) }
        }
}

/** `UpdateServiceCategoryDto` — verilmeyen alan değişmez. Kategoride temizlenebilir alan yok. */
data class UpdateServiceCategoryInput(
    val slug: String? = null,
    val name: String? = null,
    val sortOrder: Int? = null,
    val isActive: Boolean? = null,
) {
    val isEmpty: Boolean get() = slug == null && name == null && sortOrder == null && isActive == null

    fun toJson(): JsonObject =
        buildJsonObject {
            slug?.let { put("slug", it) }
            name?.let { put("name", it) }
            sortOrder?.let { put("sortOrder", it) }
            isActive?.let { put("isActive", it) }
        }
}

/** `CreateServiceDto`. */
data class CreateServiceInput(
    val categoryId: String,
    val slug: String,
    val name: String,
    val durationMinutes: Int,
    val priceMinor: Long,
    val description: String? = null,
    val bufferBeforeMinutes: Int? = null,
    val bufferAfterMinutes: Int? = null,
    val vatRateBasisPoints: Int? = null,
    val calendarColor: String? = null,
    val isOnlineBookable: Boolean? = null,
    val isActive: Boolean? = null,
    val branchOverrides: List<BranchServiceOverrideInput> = emptyList(),
) {
    fun toJson(): JsonObject =
        buildJsonObject {
            put("categoryId", categoryId)
            put("slug", slug)
            put("name", name)
            description?.let { put("description", it) }
            put("durationMinutes", durationMinutes)
            bufferBeforeMinutes?.let { put("bufferBeforeMinutes", it) }
            bufferAfterMinutes?.let { put("bufferAfterMinutes", it) }
            put("priceMinor", priceMinor)
            vatRateBasisPoints?.let { put("vatRateBasisPoints", it) }
            calendarColor?.let { put("calendarColor", it) }
            isOnlineBookable?.let { put("isOnlineBookable", it) }
            isActive?.let { put("isActive", it) }
            if (branchOverrides.isNotEmpty()) putOverrides(branchOverrides)
        }
}

/**
 * `UpdateServiceDto` — verilmeyen alan **değişmez**.
 *
 * [description] ve [calendarColor] üç durumludur ([Patch]): sunucu ikisinde `null`'ı
 * "temizle" diye okuyor. iOS ikisini `String?` ile gönderiyor ve `nil` gövdeden atıldığı
 * için bir hizmetin rengini ya da açıklamasını **kaldıramıyor** — §7.8 notu.
 *
 * [branchOverrides] verilirse şube farkları **tamamen** bununla değiştirilir; listede
 * olmayan şubenin farkı silinir. Boş liste "tüm farkları kaldır" demektir, `null` "dokunma".
 */
data class UpdateServiceInput(
    val categoryId: String? = null,
    val slug: String? = null,
    val name: String? = null,
    val description: Patch<String> = Patch.Unchanged,
    val durationMinutes: Int? = null,
    val bufferBeforeMinutes: Int? = null,
    val bufferAfterMinutes: Int? = null,
    val priceMinor: Long? = null,
    val vatRateBasisPoints: Int? = null,
    val calendarColor: Patch<String> = Patch.Unchanged,
    val isOnlineBookable: Boolean? = null,
    val isActive: Boolean? = null,
    val branchOverrides: List<BranchServiceOverrideInput>? = null,
) {
    val isEmpty: Boolean
        get() =
            categoryId == null && slug == null && name == null && durationMinutes == null &&
                bufferBeforeMinutes == null && bufferAfterMinutes == null && priceMinor == null &&
                vatRateBasisPoints == null && isOnlineBookable == null && isActive == null &&
                branchOverrides == null && description == Patch.Unchanged && calendarColor == Patch.Unchanged

    fun toJson(): JsonObject =
        buildJsonObject {
            categoryId?.let { put("categoryId", it) }
            slug?.let { put("slug", it) }
            name?.let { put("name", it) }
            putPatchElement("description", description) { JsonPrimitive(it) }
            durationMinutes?.let { put("durationMinutes", it) }
            bufferBeforeMinutes?.let { put("bufferBeforeMinutes", it) }
            bufferAfterMinutes?.let { put("bufferAfterMinutes", it) }
            priceMinor?.let { put("priceMinor", it) }
            vatRateBasisPoints?.let { put("vatRateBasisPoints", it) }
            putPatchElement("calendarColor", calendarColor) { JsonPrimitive(it) }
            isOnlineBookable?.let { put("isOnlineBookable", it) }
            isActive?.let { put("isActive", it) }
            branchOverrides?.let { putOverrides(it) }
        }
}

private fun JsonObjectBuilder.putOverrides(overrides: List<BranchServiceOverrideInput>) {
    putJsonArray("branchOverrides") {
        overrides.filterNot { it.isEmpty }.forEach { override ->
            addJsonObject {
                put("branchId", override.branchId)
                override.durationMinutes?.let { put("durationMinutes", it) }
                override.bufferBeforeMinutes?.let { put("bufferBeforeMinutes", it) }
                override.bufferAfterMinutes?.let { put("bufferAfterMinutes", it) }
                override.priceMinor?.let { put("priceMinor", it) }
                override.vatRateBasisPoints?.let { put("vatRateBasisPoints", it) }
                override.isOnlineBookable?.let { put("isOnlineBookable", it) }
                override.isActive?.let { put("isActive", it) }
            }
        }
    }
}
