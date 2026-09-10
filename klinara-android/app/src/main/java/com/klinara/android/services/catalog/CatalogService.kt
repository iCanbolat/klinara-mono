package com.klinara.android.services.catalog

/**
 * Hizmet kataloğu.
 *
 * Doküman katalogu A7.1'e koyuyor; **okuma yarısının bir metodu** A3.4'e alındı:
 * randevu oluşturmak hizmet seçmeyi gerektiriyor ve hizmetlerin adı, süresi ve fiyatı
 * yalnız buradan geliyor. Düzenleme ekranları A7.1'de.
 */
interface CatalogService {
    /** `GET services` — kiracının tüm hizmetleri (pasifler dahil; süzme istemcide). */
    suspend fun services(): List<ClinicService>
}
