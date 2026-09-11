package com.klinara.android.features.catalog

import com.klinara.android.services.catalog.CatalogService
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.catalog.ServiceCategory
import com.klinara.android.services.formatting.SearchText
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/**
 * Katalogun tek bir okunuşu — kategoriler ve hizmetler birlikte.
 *
 * iOS `CatalogStore.Catalog` paritesi. Oturum ömürlü bir store değil (A5.1 kararı): her
 * ekran kendi ViewModel'inde çeker; gruplama kuralı ise tek yerde, burada.
 */
data class CatalogSnapshot(
    val categories: List<ServiceCategory>,
    val services: List<ClinicService>,
) {
    val isEmpty: Boolean get() = categories.isEmpty() && services.isEmpty()

    fun category(id: String): ServiceCategory? = categories.firstOrNull { it.id == id }

    /** Kategorideki AKTİF hizmet sayısı — kategori listesindeki "N hizmet". */
    fun activeServiceCount(categoryId: String): Int = services.count { it.categoryId == categoryId && it.isActive }

    /**
     * Hizmetleri kategoriye göre gruplar: gruplar kategori `sortOrder`'ında, kategorisi
     * bilinmeyenler sonda (`category == null` → "Kategorisiz"). Boş gruplar atılır.
     */
    fun grouped(visible: List<ClinicService>): List<Group> {
        val known = categories.sortedWith(compareBy<ServiceCategory> { it.sortOrder }.thenBy { it.name })
        val groups =
            known.mapNotNull { category ->
                visible.filter { it.categoryId == category.id }.takeIf { it.isNotEmpty() }?.let { Group(category, it) }
            }
        val orphans = visible.filter { service -> known.none { it.id == service.categoryId } }
        return if (orphans.isEmpty()) groups else groups + Group(null, orphans)
    }

    /**
     * Liste süzgeci: pasifler istenmedikçe gizlenir (şubenin ETKİN değerine göre — şubede
     * kapatılmış hizmet orada pasiftir), arama ad ve slug'da Türkçe duyarlı, sıra ada göre.
     */
    fun filtered(
        query: String,
        showsInactive: Boolean,
        branchId: String?,
    ): List<ClinicService> =
        services
            .filter { showsInactive || it.effective(branchId).isActive }
            .filter { SearchText.matches(it.name, query) || SearchText.matches(it.slug, query) }
            .sortedBy { SearchText.fold(it.name) }

    data class Group(
        val category: ServiceCategory?,
        val services: List<ClinicService>,
    ) {
        val title: String get() = category?.name ?: "Kategorisiz"
    }
}

/**
 * Kategoriler ve hizmetler **paralel** (iOS `CatalogStore.load` gibi); biri düşerse ikisi de
 * düşer — kategorisiz bir liste gruplanamaz, hizmetsiz bir kategori listesi sayı gösteremez.
 */
suspend fun CatalogService.snapshot(): CatalogSnapshot =
    coroutineScope {
        val categories = async { categories() }
        val services = async { services() }
        CatalogSnapshot(categories.await(), services.await())
    }
