package com.klinara.android.services.staff

/**
 * Personel uçları — `staff:read` okur, `staff:write` yazar.
 *
 * Takvim personel adı ve rengi olmadan çizilemediği için servisin **okuma yarısı** A3.1'e
 * alınmıştı; yazma yarısı A7.2'de geldi. Silme yok: pasife almak `update(isActive = false)`.
 */
interface StaffService {
    /**
     * `GET staff` — [branchId] verilmezse kiracının tüm personeli. Verilirse (A7.4–A7.5) yalnız o
     * şubeye ait olanlar: ana şube VEYA şube üyeliği ([StaffProfile.worksIn]). Erişilemeyen
     * şube 403 `BRANCH_FORBIDDEN`.
     */
    suspend fun list(branchId: String? = null): List<StaffProfile>

    /** `GET staff/:id`. */
    suspend fun profile(id: String): StaffProfile

    /** `POST staff`. Aynı kullanıcıya ikinci profil 409. */
    suspend fun create(input: CreateStaffProfileInput): StaffProfile

    /** `PATCH staff/:id`. */
    suspend fun update(
        id: String,
        input: UpdateStaffProfileInput,
    ): StaffProfile

    /** `PUT staff/:id/services` — yetkinlik listesini TAMAMEN değiştirir. */
    suspend fun replaceSkills(
        id: String,
        input: ReplaceStaffServicesInput,
    ): StaffProfile
}
