package com.klinara.android.services.staff

import kotlinx.serialization.Serializable

/**
 * Personel profili — `StaffProfileResponseDto`.
 *
 * A3.1 bunun üç alanını kullanıyor: [userFullName] (filtre çipi ve randevu satırı),
 * [calendarColor] (blok aksanı) ve [isActive] (pasif personel filtrede görünmez).
 * [services] A3.4'ün "bu hizmetlerin hepsinde yetkin personel" hesabı için;
 * A7.2 yazma metotlarını ekler, bu modeli yeniden kurmaz.
 */
@Serializable
data class StaffProfile(
    val id: String,
    val userId: String,
    val userFullName: String,
    val primaryBranchId: String? = null,
    val title: String? = null,
    val specialties: List<String> = emptyList(),
    /** `#1A6A7A` — sunucu null gönderebilir; ekran token'lı bir varsayılana düşer. */
    val calendarColor: String? = null,
    val isActive: Boolean = true,
    val services: List<StaffServiceSkill> = emptyList(),
) {
    /** [branchId] null ise kiracı geneli yetkinlik de sayılır. */
    fun isCompetent(
        serviceId: String,
        branchId: String?,
    ): Boolean =
        services.any {
            it.isActive && it.serviceId == serviceId && (it.branchId == null || it.branchId == branchId)
        }
}

/** Personel–hizmet yetkinliği — `StaffServiceResponseDto`. */
@Serializable
data class StaffServiceSkill(
    val id: String,
    val serviceId: String,
    /** null → kiracı geneli yetkinlik. */
    val branchId: String? = null,
    val customDurationMinutes: Int? = null,
    val customPriceMinor: Long? = null,
    val isActive: Boolean = true,
)
