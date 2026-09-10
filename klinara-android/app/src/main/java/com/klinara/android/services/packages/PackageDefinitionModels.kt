package com.klinara.android.services.packages

import com.klinara.android.services.crm.Patch
import com.klinara.android.services.crm.putPatchElement
import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.time.Instant
import kotlin.math.roundToInt

// Bu dosyadaki tipler `apps/api/src/modules/packages/dto/package-definition.dto.ts`
// içindeki DTO'lardan birebir türetilmiştir; alan adları sunucudakiyle aynıdır.
// Para `Long` minor unit'tir (§5.4) — iOS'ta `Int`, burada bilerek daha geniş.

/**
 * `PackageDefinitionItemResponseDto` — paketin bir hizmet kalemi.
 *
 * [unitListPriceMinor] **katalog** birim fiyatıdır, paketin satış fiyatının bu kaleme
 * düşen payı değil. İkisi kasten ayrı: kampanyalı paketin indirimi ancak liste toplamıyla
 * satış fiyatı yan yana konunca görünür.
 */
@Serializable
data class PackageDefinitionItem(
    val id: String,
    val serviceId: String,
    /** Sunucunun kataloğa join'leyip verdiği ad — hizmet listesini beklemeden çizilsin. */
    val serviceName: String = "",
    val quantity: Int = 0,
    val unitListPriceMinor: Long = 0,
    val sortOrder: Int = 0,
) {
    /** Bu kalemin katalog fiyatından toplam karşılığı. */
    val listTotalMinor: Long get() = unitListPriceMinor * quantity
}

/**
 * `PackageDefinitionResponseDto` — satılabilir paket şablonu (A5.1).
 *
 * İki ayrı sayaç taşır ve ikisi karıştırılmamalı: [revision] satışı etkileyen alanlar
 * değiştikçe artar ve satılan paket onu **snapshot** olarak saklar; [version] ise
 * `If-Match` için iyimser kilit sayacıdır ve her yazmada artar.
 */
@Serializable
data class PackageDefinition(
    val id: String,
    /** `null` **tüm şubeler** demektir, "şubesiz" değil. */
    val branchId: String? = null,
    val slug: String,
    val name: String,
    val description: String? = null,
    /** Paketin SATIŞ fiyatı. */
    val totalPriceMinor: Long = 0,
    /**
     * Kalemlerin GÜNCEL katalog fiyatları toplamı. Satılmış paketlerin yükümlülüğü
     * buradan DEĞİL, satış anındaki tahsisten hesaplanır.
     */
    val listPriceMinor: Long = 0,
    val currency: String = "TRY",
    /** `null` süresiz paket demektir; `0` aynı şey değildir ve sunucu kabul etmez. */
    val validityDays: Int? = null,
    val isTransferable: Boolean = true,
    val isOnlineSellable: Boolean = false,
    val isActive: Boolean = true,
    val revision: Int = 1,
    val version: Int = 1,
    val items: List<PackageDefinitionItem> = emptyList(),
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
    @Serializable(with = InstantSerializer::class)
    val updatedAt: Instant? = null,
    /**
     * Dolu ise tanım arşivlenmiş (soft delete). Satılmış paketlerin izini kesmemek için
     * satır silinmez.
     */
    @Serializable(with = InstantSerializer::class)
    val deletedAt: Instant? = null,
) {
    /** Satılmış paket tanımı arşivlenemez, yalnız pasife alınır — iki durumu ayırmak için. */
    val isArchived: Boolean get() = deletedAt != null

    val totalSessions: Int get() = items.sumOf { it.quantity }

    val sortedItems: List<PackageDefinitionItem> get() = items.sortedBy { it.sortOrder }

    /**
     * İndirim tutarı — liste toplamı satış fiyatından büyükse.
     *
     * `null` indirim YOK demektir; sıfır döndürmek ekranda "indirim var ama 0 ₺" gibi
     * okunurdu.
     */
    val discountMinor: Long?
        get() = (listPriceMinor - totalPriceMinor).takeIf { it > 0 }

    /** Yüzde olarak indirim — rozet metni için, hesap için değil. */
    val discountPercent: Int?
        get() {
            val discount = discountMinor ?: return null
            if (listPriceMinor <= 0) return null
            return (discount.toDouble() / listPriceMinor * PERCENT).roundToInt()
        }

    /** Satış sayfasında seçilebilir mi — pasif ve arşivlenmiş tanım satılamaz. */
    fun isSellable(branchId: String?): Boolean {
        if (!isActive || isArchived) return false
        // `branchId == null` tüm şubeler demek, "şubesiz" değil.
        val scope = this.branchId ?: return true
        return scope == branchId
    }
}

/** Dosya düzeyinde: `private companion`, üretilen `serializer()`'ı da gizliyordu. */
private const val PERCENT = 100

/** `PackageDefinitionItemInputDto`. Sunucu yalnız hizmet ve adet bekler; fiyat katalogdan gelir. */
data class PackageDefinitionItemInput(
    val serviceId: String,
    val quantity: Int,
)

/** `CreatePackageDefinitionDto`. */
data class CreatePackageDefinitionInput(
    val slug: String,
    val name: String,
    val totalPriceMinor: Long,
    val items: List<PackageDefinitionItemInput>,
    val description: String? = null,
    /** Verilmezse paket tüm şubelerde satılır. */
    val branchId: String? = null,
    val validityDays: Int? = null,
    val isTransferable: Boolean? = null,
    val isOnlineSellable: Boolean? = null,
    val isActive: Boolean? = null,
) {
    fun toJson(): JsonObject =
        buildJsonObject {
            put("slug", slug)
            put("name", name)
            description?.let { put("description", it) }
            put("totalPriceMinor", totalPriceMinor)
            branchId?.let { put("branchId", it) }
            validityDays?.let { put("validityDays", it) }
            isTransferable?.let { put("isTransferable", it) }
            isOnlineSellable?.let { put("isOnlineSellable", it) }
            isActive?.let { put("isActive", it) }
            putItems(items)
        }
}

/**
 * `UpdatePackageDefinitionDto` — verilmeyen alan **değişmez**.
 *
 * [description] ve [validityDays] üç durumludur ([Patch]): "dokunma", "şu değer" ve
 * "temizle". `validityDays`'in temizlenmesi paketi SÜRESİZ yapar; `0` göndermek aynı şey
 * değildir, sunucu da kabul etmez.
 *
 * [items] verilirse kalem listesi **tamamen** bununla değiştirilir.
 *
 * Slug ve şube burada YOK: ikisi de satılmış paketlerin izini taşır ve sunucu `PATCH`
 * gövdesinde ikisini de reddeder. Derleme zamanında ifade edilemez kılmak, çalışma
 * anında 400 almaktan iyidir.
 */
data class UpdatePackageDefinitionInput(
    val name: String? = null,
    val description: Patch<String> = Patch.Unchanged,
    val totalPriceMinor: Long? = null,
    val validityDays: Patch<Int> = Patch.Unchanged,
    val isTransferable: Boolean? = null,
    val isOnlineSellable: Boolean? = null,
    val isActive: Boolean? = null,
    val items: List<PackageDefinitionItemInput>? = null,
) {
    /** Satışı etkileyen bir alan mı değişiyor — sunucu bunda `revision`'ı artırır. */
    val affectsSale: Boolean
        get() =
            totalPriceMinor != null || items != null || validityDays != Patch.Unchanged ||
                isTransferable != null

    val isEmpty: Boolean
        get() =
            name == null && totalPriceMinor == null && isTransferable == null &&
                isOnlineSellable == null && isActive == null && items == null &&
                description == Patch.Unchanged && validityDays == Patch.Unchanged

    fun toJson(): JsonObject =
        buildJsonObject {
            name?.let { put("name", it) }
            putPatchElement("description", description) { JsonPrimitive(it) }
            totalPriceMinor?.let { put("totalPriceMinor", it) }
            putPatchElement("validityDays", validityDays) { JsonPrimitive(it) }
            isTransferable?.let { put("isTransferable", it) }
            isOnlineSellable?.let { put("isOnlineSellable", it) }
            isActive?.let { put("isActive", it) }
            items?.let { putItems(it) }
        }
}

private fun kotlinx.serialization.json.JsonObjectBuilder.putItems(items: List<PackageDefinitionItemInput>) {
    putJsonArray("items") {
        items.forEach { item ->
            addJsonObject {
                put("serviceId", item.serviceId)
                put("quantity", item.quantity)
            }
        }
    }
}
