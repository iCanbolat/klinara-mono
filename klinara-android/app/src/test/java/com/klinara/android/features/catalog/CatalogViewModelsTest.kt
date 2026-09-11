package com.klinara.android.features.catalog

import com.klinara.android.services.catalog.CatalogService
import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.catalog.ServiceCategory
import com.klinara.android.services.catalog.UpdateServiceCategoryInput
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CatalogViewModelsTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    @Test
    @DisplayName("Liste kategoriye göre gruplanıyor, pasif gizli, şube değerleri etkin olanlar")
    fun listGroupsAndFilters() =
        runTest {
            val viewModel = ServiceListViewModel(MockCatalogService(latencyEnabled = false))
            viewModel.ensureLoaded()
            advanceUntilIdle()

            val snapshot = requireNotNull(viewModel.state.value.catalog.valueOrNull)
            val visible = snapshot.filtered(query = "", showsInactive = false, branchId = MockIds.BRANCH_BODRUM)
            assertFalse(visible.any { it.id == MockIds.SERVICE_MASK }, "Pasif maske gizli")
            val groups = snapshot.grouped(visible)
            assertEquals(listOf("Cilt Bakımı", "Epilasyon", "Enjeksiyon İşlemleri"), groups.map { it.title })

            val laser = visible.first { it.id == MockIds.SERVICE_LASER }.effective(MockIds.BRANCH_BODRUM)
            assertEquals(165_000L, laser.priceMinor, "Bodrum'un fiyatı")
            assertTrue(laser.isOverridden)
        }

    @Test
    @DisplayName("Arama Türkçe duyarlı: 'CİLT' → Cilt bakımı")
    fun turkishSearch() {
        val snapshot = CatalogSnapshot(MockCatalogService.CATEGORIES, MockCatalogService.ALL)
        assertEquals(
            listOf(MockIds.SERVICE_SKIN_CARE),
            snapshot.filtered("CİLT", showsInactive = true, branchId = null).map { it.id },
        )
    }

    @Test
    @DisplayName("Kategorisi bilinmeyen hizmet 'Kategorisiz' grubuna, sona düşüyor")
    fun orphansGoLast() {
        val orphan = MockCatalogService.ALL.first().copy(id = "yetim", categoryId = "silinmiş")
        val snapshot = CatalogSnapshot(MockCatalogService.CATEGORIES, MockCatalogService.ALL + orphan)
        val groups = snapshot.grouped(snapshot.filtered("", showsInactive = true, branchId = null))
        assertEquals("Kategorisiz", groups.last().title)
        assertNull(groups.last().category)
    }

    @Test
    @DisplayName("Pasife alma listeyi yerinde güncelliyor")
    fun deactivateUpdatesInPlace() =
        runTest {
            val viewModel = ServiceListViewModel(MockCatalogService(latencyEnabled = false))
            viewModel.ensureLoaded()
            advanceUntilIdle()
            val laser = viewModel.state.value.catalog.valueOrNull!!.services.first { it.id == MockIds.SERVICE_LASER }

            viewModel.askDeactivate(laser)
            viewModel.confirmDeactivate()
            advanceUntilIdle()

            val updated = viewModel.state.value.catalog.valueOrNull!!.services.first { it.id == MockIds.SERVICE_LASER }
            assertFalse(updated.isActive)
            assertNull(viewModel.state.value.error)
        }

    @Test
    @DisplayName("Kullanımdaki kategoriyi pasife alma hatası YUTULMUYOR — afişte sunucunun metni")
    fun categoryDeactivateErrorSurfaces() =
        runTest {
            val viewModel = ServiceCategoryListViewModel(MockCatalogService(latencyEnabled = false))
            viewModel.load()
            advanceUntilIdle()
            val injection = viewModel.state.value.categories.first { it.id == MockIds.CATEGORY_INJECTION }

            viewModel.askDeactivate(injection)
            viewModel.confirmDeactivate()
            advanceUntilIdle()

            assertEquals("Kullanımda olan hizmet kategorisi pasife alınamaz", viewModel.state.value.error)
            assertTrue(viewModel.state.value.categories.first { it.id == MockIds.CATEGORY_INJECTION }.isActive)
        }

    @Test
    @DisplayName("Aşağı taşıma iki PATCH ile sırayı takas ediyor")
    fun moveSwapsOrder() =
        runTest {
            val viewModel = ServiceCategoryListViewModel(MockCatalogService(latencyEnabled = false))
            viewModel.load()
            advanceUntilIdle()
            val first = viewModel.state.value.categories.first()

            viewModel.move(first, 1)
            advanceUntilIdle()

            assertEquals(
                listOf(MockIds.CATEGORY_EPILATION, MockIds.CATEGORY_SKIN_CARE, MockIds.CATEGORY_INJECTION),
                viewModel.state.value.categories.map { it.id },
            )
        }

    @Test
    @DisplayName("Sıralamanın ikinci yazması düşerse hata görünür ve liste SUNUCUDAN yeniden çekilir")
    fun moveFailureReloads() =
        runTest {
            val inner = MockCatalogService(latencyEnabled = false)
            val failingSecond =
                object : CatalogService by inner {
                    var calls = 0

                    override suspend fun updateCategory(
                        id: String,
                        input: UpdateServiceCategoryInput,
                    ): ServiceCategory {
                        calls += 1
                        if (calls == 2) throw ApiError.Network()
                        return inner.updateCategory(id, input)
                    }
                }
            val viewModel = ServiceCategoryListViewModel(failingSecond)
            viewModel.load()
            advanceUntilIdle()

            viewModel.move(viewModel.state.value.categories.first(), 1)
            advanceUntilIdle()

            assertNotNull(viewModel.state.value.error)
            // Sunucunun gerçeği: ilk yazma geçti, iki kategori aynı sırayı taşıyor — gösterilen o.
            val orders = viewModel.state.value.categories.map { it.sortOrder }
            assertEquals(listOf(1, 1, 2), orders)
        }

    @Test
    @DisplayName("Kategori editöründe slug çakışması diyalogun İÇİNDE gösteriliyor, diyalog açık kalıyor")
    fun draftConflictStaysInDialog() =
        runTest {
            val viewModel = ServiceCategoryListViewModel(MockCatalogService(latencyEnabled = false))
            viewModel.load()
            advanceUntilIdle()

            viewModel.startCreate()
            viewModel.updateDraft { it.withName("Epilasyon") }
            viewModel.saveDraft()
            advanceUntilIdle()

            val state = viewModel.state.value
            assertNotNull(state.draft)
            assertEquals("Bu hizmet kategorisi kodu zaten kullanımda", state.draftError)
            assertNull(state.error)
        }

    @Test
    @DisplayName("Editör yeni hizmette ilk AKTİF kategoriyi seçiyor; kayıt `saved`'a düşüyor")
    fun editorCreates() =
        runTest {
            val catalog = MockCatalogService(latencyEnabled = false)
            // Sırada ilk ama PASİF: varsayılan olarak seçilmemeli.
            catalog.createCategory(
                com.klinara.android.services.catalog.CreateServiceCategoryInput(
                    slug = "arsiv",
                    name = "Arşiv",
                    sortOrder = 0,
                    isActive = false,
                ),
            )
            val viewModel = ServiceEditorViewModel(catalog, serviceId = null)
            viewModel.load()
            advanceUntilIdle()
            assertEquals(MockIds.CATEGORY_SKIN_CARE, viewModel.state.value.form.categoryId)

            viewModel.update { it.withName("Yüz lazeri").copy(priceMinor = 70_000) }
            viewModel.save()
            advanceUntilIdle()

            assertEquals("yuz-lazeri", viewModel.state.value.saved?.slug)
        }

    @Test
    @DisplayName("Editörde alan hatası afişe değil alana düşüyor")
    fun editorFieldErrors() =
        runTest {
            val inner = MockCatalogService(latencyEnabled = false)
            val rejecting =
                object : CatalogService by inner {
                    override suspend fun createService(
                        input: com.klinara.android.services.catalog.CreateServiceInput,
                    ) = throw MockErrors.validation("priceMinor", "Fiyat negatif olamaz")
                }
            val viewModel = ServiceEditorViewModel(rejecting, serviceId = null)
            viewModel.load()
            advanceUntilIdle()
            viewModel.update { it.withName("X hizmeti").copy(priceMinor = 1) }
            viewModel.save()
            advanceUntilIdle()

            assertNull(viewModel.state.value.error)
            assertEquals("Fiyat negatif olamaz", viewModel.state.value.fieldErrors["priceMinor"])
        }
}
