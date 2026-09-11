package com.klinara.android.services.staff

/**
 * Personel uçları — `staff:read` okur, `staff:write` yazar.
 *
 * Takvim personel adı ve rengi olmadan çizilemediği için servisin **okuma yarısı** A3.1'e
 * alınmıştı; yazma yarısı A7.2'de geldi. Silme yok: pasife almak `update(isActive = false)`.
 */
interface StaffService {
    /** `GET staff` — kiracının tüm personeli. Sunucu şubeye göre daraltmıyor. */
    suspend fun list(): List<StaffProfile>

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
