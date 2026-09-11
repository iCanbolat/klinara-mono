package com.klinara.android.services.staff

import com.klinara.android.services.crm.Patch
import com.klinara.android.services.crm.putPatchElement
import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.time.Instant

// Bu dosyadaki tipler `apps/api/src/modules/staff/dto/staff.dto.ts` içindeki DTO'lardan
// birebir türetilmiştir. Personel uçlarında If-Match / sürüm YOK; silme de yok —
// pasife almak `PATCH isActive: false`.

/**
 * Personel profili — `StaffProfileResponseDto`.
 *
 * A3.1 bunun üç alanını kullanıyordu: [userFullName] (filtre çipi ve randevu satırı),
 * [calendarColor] (blok aksanı) ve [isActive] (pasif personel filtrede görünmez).
 * [services] A3.4'ün "bu hizmetlerin hepsinde yetkin personel" hesabı için; A7.2 profilin
 * kalanını (e-posta, tanıtım, online görünürlük) ekledi.
 */
@Serializable
data class StaffProfile(
    val id: String,
    val tenantId: String = "",
    val userId: String,
    val userFullName: String,
    val userEmail: String = "",
    val primaryBranchId: String? = null,
    val title: String? = null,
    val specialties: List<String> = emptyList(),
    /** `#1A6A7A` — sunucu null gönderebilir; ekran token'lı bir varsayılana düşer. */
    val calendarColor: String? = null,
    val bio: String? = null,
    val isVisibleOnline: Boolean = true,
    val isActive: Boolean = true,
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
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

    /** Listedeki "N hizmet" — AKTİF yetkinliklerin FARKLI hizmet sayısı (iki şube kapsamı tek hizmet). */
    val activeServiceCount: Int get() = services.filter { it.isActive }.map { it.serviceId }.toSet().size
}

/** Personel–hizmet yetkinliği — `StaffServiceResponseDto`. */
@Serializable
data class StaffServiceSkill(
    val id: String,
    val staffProfileId: String = "",
    val serviceId: String,
    /** null → kiracı geneli yetkinlik. */
    val branchId: String? = null,
    val customDurationMinutes: Int? = null,
    val customPriceMinor: Long? = null,
    val isActive: Boolean = true,
) {
    fun toInput(): StaffServiceSkillInput =
        StaffServiceSkillInput(
            serviceId = serviceId,
            branchId = branchId,
            customDurationMinutes = customDurationMinutes,
            customPriceMinor = customPriceMinor,
            isActive = isActive,
        )
}

/**
 * `StaffServiceInputDto`. [branchId] verilmezse yetkinlik **tüm şubelerde** geçerli.
 * Aynı (`serviceId`, `branchId`) çifti bir istekte iki kez olamaz — sunucu 400.
 */
data class StaffServiceSkillInput(
    val serviceId: String,
    val branchId: String? = null,
    val customDurationMinutes: Int? = null,
    val customPriceMinor: Long? = null,
    val isActive: Boolean? = null,
)

/**
 * `CreateStaffProfileDto`. Profil **var olan** bir kullanıcıya bağlanır — kullanıcı önce
 * davet edilir (`POST invitations`), kabul eder, sonra buradan profili açılır.
 */
data class CreateStaffProfileInput(
    val userId: String,
    val primaryBranchId: String? = null,
    val title: String? = null,
    val specialties: List<String> = emptyList(),
    val calendarColor: String? = null,
    val bio: String? = null,
    val isVisibleOnline: Boolean? = null,
    val isActive: Boolean? = null,
) {
    fun toJson(): JsonObject =
        buildJsonObject {
            put("userId", userId)
            primaryBranchId?.let { put("primaryBranchId", it) }
            title?.let { put("title", it) }
            if (specialties.isNotEmpty()) put("specialties", JsonArray(specialties.map(::JsonPrimitive)))
            calendarColor?.let { put("calendarColor", it) }
            bio?.let { put("bio", it) }
            isVisibleOnline?.let { put("isVisibleOnline", it) }
            isActive?.let { put("isActive", it) }
        }
}

/**
 * `UpdateStaffProfileDto` — verilmeyen alan **değişmez**.
 *
 * Birincil şube, unvan, renk ve tanıtım üç durumludur ([Patch]): sunucu dördünde de `null`'ı
 * "temizle" diye okuyor. iOS `nil`'i gövdeden attığı için bir personelin unvanını ya da
 * birincil şubesini **kaldıramıyor** — §7.8 notu.
 */
data class UpdateStaffProfileInput(
    val primaryBranchId: Patch<String> = Patch.Unchanged,
    val title: Patch<String> = Patch.Unchanged,
    val specialties: List<String>? = null,
    val calendarColor: Patch<String> = Patch.Unchanged,
    val bio: Patch<String> = Patch.Unchanged,
    val isVisibleOnline: Boolean? = null,
    val isActive: Boolean? = null,
) {
    val isEmpty: Boolean
        get() =
            specialties == null && isVisibleOnline == null && isActive == null &&
                listOf(primaryBranchId, title, calendarColor, bio).all { it == Patch.Unchanged }

    fun toJson(): JsonObject =
        buildJsonObject {
            putPatchElement("primaryBranchId", primaryBranchId) { JsonPrimitive(it) }
            putPatchElement("title", title) { JsonPrimitive(it) }
            specialties?.let { put("specialties", JsonArray(it.map(::JsonPrimitive))) }
            putPatchElement("calendarColor", calendarColor) { JsonPrimitive(it) }
            putPatchElement("bio", bio) { JsonPrimitive(it) }
            isVisibleOnline?.let { put("isVisibleOnline", it) }
            isActive?.let { put("isActive", it) }
        }
}

/** `ReplaceStaffServicesDto` — yetkinlik listesi TAMAMEN bununla değiştirilir; boş liste hepsini siler. */
data class ReplaceStaffServicesInput(
    val services: List<StaffServiceSkillInput>,
) {
    fun toJson(): JsonObject =
        buildJsonObject {
            putJsonArray("services") {
                services.forEach { skill ->
                    addJsonObject {
                        put("serviceId", skill.serviceId)
                        skill.branchId?.let { put("branchId", it) }
                        skill.customDurationMinutes?.let { put("customDurationMinutes", it) }
                        skill.customPriceMinor?.let { put("customPriceMinor", it) }
                        skill.isActive?.let { put("isActive", it) }
                    }
                }
            }
        }
}
