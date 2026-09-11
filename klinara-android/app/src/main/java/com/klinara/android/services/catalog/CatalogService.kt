package com.klinara.android.services.catalog

/**
 * Hizmet kataloğu — `service:read` okur, `service:write` yazar.
 *
 * Okuma yarısının bir metodu A3.4'e alınmıştı (randevu oluşturmak hizmet seçmeyi
 * gerektiriyor); yazma yarısı ve kategoriler A7.1'de geldi.
 *
 * **Silme yok.** İki `deactivate*` metodu sunucuda `DELETE` ama kaydı silmez, pasife alır
 * ve güncel kaydı döner (204 değil): geçmiş randevular ve paketler hizmete bağlı kalmalı.
 * Aktif hizmeti olan kategori pasife alınamaz — 409 `CONFLICT`, metni sunucudan.
 */
interface CatalogService {
    /** `GET service-categories` — sıralı (`sortOrder`, sonra ad); pasifler dahil. */
    suspend fun categories(): List<ServiceCategory>

    /** `POST service-categories`. Slug çakışması 409. */
    suspend fun createCategory(input: CreateServiceCategoryInput): ServiceCategory

    /** `PATCH service-categories/:id`. */
    suspend fun updateCategory(
        id: String,
        input: UpdateServiceCategoryInput,
    ): ServiceCategory

    /** `DELETE service-categories/:id` — pasife alır, kaydı döner. */
    suspend fun deactivateCategory(id: String): ServiceCategory

    /** `GET services` — kiracının tüm hizmetleri (pasifler dahil; süzme istemcide). */
    suspend fun services(): List<ClinicService>

    /** `GET services/:id`. */
    suspend fun service(id: String): ClinicService

    /** `POST services`. */
    suspend fun createService(input: CreateServiceInput): ClinicService

    /** `PATCH services/:id`. `branchOverrides` verilirse listeyi tamamen değiştirir. */
    suspend fun updateService(
        id: String,
        input: UpdateServiceInput,
    ): ClinicService

    /** `DELETE services/:id` — pasife alır, kaydı döner. */
    suspend fun deactivateService(id: String): ClinicService
}
