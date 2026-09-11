package com.klinara.android.features.staff

import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.staff.StaffServiceSkill
import com.klinara.android.services.staff.StaffServiceSkillInput

/**
 * Yetkinlik matrisi taslağı — iOS `StaffServiceMatrixView` draft'ının paritesi, **kayıpsız**.
 *
 * `PUT staff/:id/services` listeyi TAMAMEN değiştiriyor; yani taslakta olmayan her yetkinlik
 * kayıtta **silinir**. iOS draft'ı `serviceId` ile anahtarlıyor: aynı hizmet için iki şube
 * kapsamı olan bir personelde biri sessizce kayboluyor ve pasif yetkinlik satırları da
 * düşüyor. Burada ekranın düzenlediği satır hizmet başına BİR tane ([rows]); gösterilmeyen
 * diğer satırlar [preserved]'da aynen durup geri yazılıyor (`SkillMatrixDraftTest`).
 *
 * Tek istisna: **pasif ya da katalogda olmayan hizmetin yetkinliği** geri yazılamaz — sunucu
 * pasif hizmete yetkinliği 409 ile reddediyor (`K0002`). Onlar [dropped]'da; ekran kaydın
 * onları kaldıracağını SÖYLÜYOR, sessizce yapmıyor.
 */
data class SkillMatrixDraft(
    val rows: Map<String, Row>,
    val preserved: List<StaffServiceSkillInput>,
    val dropped: List<StaffServiceSkill>,
    private val original: List<StaffServiceSkillInput>,
) {
    /** Hizmet başına düzenlenen satır. [branchId] `null` → tüm şubeler. */
    data class Row(
        val isEnabled: Boolean = false,
        val branchId: String? = null,
        val customDurationMinutes: Int? = null,
        val customPriceMinor: Long? = null,
        /** Aynı hizmetin korunan diğer kapsamları — satırda "+N şube kapsamı". */
        val extraScopes: Int = 0,
    )

    fun row(serviceId: String): Row = rows[serviceId] ?: Row()

    /** Sıra önemsiz: sunucu listeyi küme olarak yazıyor. */
    val isDirty: Boolean get() = wire().toSet() != original.toSet()

    /** Etkin (aktif, farklı) hizmet sayısı — detaydaki sayıyla aynı hesap. */
    val enabledCount: Int get() = rows.count { it.value.isEnabled }

    fun toggle(
        serviceId: String,
        enabled: Boolean,
    ): SkillMatrixDraft = withRow(serviceId) { it.copy(isEnabled = enabled) }

    fun withScope(
        serviceId: String,
        branchId: String?,
    ): SkillMatrixDraft = withRow(serviceId) { it.copy(branchId = branchId) }

    fun withCustomDuration(
        serviceId: String,
        minutes: Int?,
    ): SkillMatrixDraft = withRow(serviceId) { it.copy(customDurationMinutes = minutes) }

    private fun withRow(
        serviceId: String,
        transform: (Row) -> Row,
    ): SkillMatrixDraft = copy(rows = rows + (serviceId to transform(row(serviceId))))

    /**
     * `PUT` gövdesi: etkin satırlar + korunanlar. Kullanıcı bir satırın kapsamını korunan
     * bir satırınkiyle aynı yaptıysa korunan düşer — aynı (hizmet, şube) çifti sunucuda 400.
     */
    fun wire(): List<StaffServiceSkillInput> {
        val edited =
            rows
                .filterValues { it.isEnabled }
                .map { (serviceId, row) ->
                    StaffServiceSkillInput(
                        serviceId = serviceId,
                        branchId = row.branchId,
                        customDurationMinutes = row.customDurationMinutes,
                        customPriceMinor = row.customPriceMinor,
                        isActive = true,
                    )
                }
        val editedPairs = edited.map { it.serviceId to it.branchId }.toSet()
        return edited + preserved.filterNot { (it.serviceId to it.branchId) in editedPairs }
    }

    companion object {
        fun of(
            skills: List<StaffServiceSkill>,
            activeServices: List<ClinicService>,
        ): SkillMatrixDraft {
            val activeIds = activeServices.filter { it.isActive }.map { it.id }.toSet()
            val (usable, dropped) = skills.partition { it.serviceId in activeIds }
            val rows = mutableMapOf<String, Row>()
            val preserved = mutableListOf<StaffServiceSkillInput>()
            usable.groupBy { it.serviceId }.forEach { (serviceId, group) ->
                // Ekranın düzenlediği satır: aktif olanlardan kiracı geneli, yoksa ilki.
                val active = group.filter { it.isActive }
                val primary = active.firstOrNull { it.branchId == null } ?: active.firstOrNull()
                val rest = group.filter { it !== primary }
                if (primary != null) {
                    rows[serviceId] =
                        Row(
                            isEnabled = true,
                            branchId = primary.branchId,
                            customDurationMinutes = primary.customDurationMinutes,
                            customPriceMinor = primary.customPriceMinor,
                            extraScopes = rest.size,
                        )
                }
                preserved += rest.map { it.toInput() }
            }
            val draft = SkillMatrixDraft(rows, preserved, dropped, original = emptyList())
            return draft.copy(original = draft.wire())
        }
    }
}
