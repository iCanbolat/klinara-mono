package com.klinara.android.features.staff

import com.klinara.android.services.crm.Patch
import com.klinara.android.services.staff.StaffProfile
import com.klinara.android.services.staff.UpdateStaffProfileInput

/**
 * Personel profili taslağı — iOS `StaffProfileDraft` paritesi, saf değer tipi.
 *
 * **iOS'tan fark:** güncelleme yalnız DEĞİŞEN alanları gönderir ve unvan, tanıtım, renk,
 * birincil şube [Patch] ile **temizlenebilir**. iOS boş unvanı `nil` yapıp gövdeden atıyor;
 * sunucu eskisini koruyor ve kullanıcı sildiği unvanı kayıttan sonra geri görüyor.
 */
data class StaffProfileDraft(
    val title: String = "",
    val bio: String = "",
    val specialties: List<String> = emptyList(),
    val calendarColor: String? = null,
    val primaryBranchId: String? = null,
    val isVisibleOnline: Boolean = true,
    val isActive: Boolean = true,
    private val original: StaffProfileDraft? = null,
) {
    val isDirty: Boolean get() = original != null && copy(original = null) != original

    fun updateInput(): UpdateStaffProfileInput {
        val base = original ?: return UpdateStaffProfileInput()
        return UpdateStaffProfileInput(
            primaryBranchId =
                if (primaryBranchId != base.primaryBranchId) Patch.orClear(primaryBranchId) else Patch.Unchanged,
            title = if (title.trim() != base.title) Patch.text(title) else Patch.Unchanged,
            specialties = specialties.takeIf { it != base.specialties },
            calendarColor = if (calendarColor != base.calendarColor) Patch.orClear(calendarColor) else Patch.Unchanged,
            bio = if (bio.trim() != base.bio) Patch.text(bio) else Patch.Unchanged,
            isVisibleOnline = isVisibleOnline.takeIf { it != base.isVisibleOnline },
            isActive = isActive.takeIf { it != base.isActive },
        )
    }

    companion object {
        fun of(profile: StaffProfile): StaffProfileDraft {
            val draft =
                StaffProfileDraft(
                    title = profile.title.orEmpty(),
                    bio = profile.bio.orEmpty(),
                    specialties = profile.specialties,
                    calendarColor = profile.calendarColor,
                    primaryBranchId = profile.primaryBranchId,
                    isVisibleOnline = profile.isVisibleOnline,
                    isActive = profile.isActive,
                )
            return draft.copy(original = draft)
        }
    }
}
