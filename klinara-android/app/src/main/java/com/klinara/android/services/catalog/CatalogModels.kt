package com.klinara.android.services.catalog

import kotlinx.serialization.Serializable

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
    val categoryId: String,
    val name: String,
    val durationMinutes: Int = 0,
    val bufferBeforeMinutes: Int = 0,
    val bufferAfterMinutes: Int = 0,
    val priceMinor: Long = 0,
    val vatRateBasisPoints: Int = 0,
    val calendarColor: String? = null,
    val isActive: Boolean = true,
    val branchOverrides: List<BranchServiceOverride> = emptyList(),
) {
    /** Şubede geçerli süre ve fiyat. Override yoksa kiracı geneli. */
    fun effective(branchId: String?): Effective {
        val override = branchOverrides.firstOrNull { it.branchId == branchId && it.isActive != false }
        return Effective(
            durationMinutes = override?.durationMinutes ?: durationMinutes,
            priceMinor = override?.priceMinor ?: priceMinor,
        )
    }

    data class Effective(
        val durationMinutes: Int,
        val priceMinor: Long,
    )
}

@Serializable
data class BranchServiceOverride(
    val branchId: String,
    val durationMinutes: Int? = null,
    val priceMinor: Long? = null,
    val isActive: Boolean? = null,
)
