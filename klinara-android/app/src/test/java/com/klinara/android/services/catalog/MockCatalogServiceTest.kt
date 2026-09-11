package com.klinara.android.services.catalog

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * Mock katalog sunucunun DAVRANIŞINI taklit ediyor mu — arayüz bu hatalara göre yazıldı.
 */
class MockCatalogServiceTest {
    private val service = MockCatalogService(latencyEnabled = false)

    private fun input(
        slug: String = "yeni-hizmet",
        overrides: List<BranchServiceOverrideInput> = emptyList(),
    ) = CreateServiceInput(
        categoryId = MockIds.CATEGORY_SKIN_CARE,
        slug = slug,
        name = "Yeni hizmet",
        durationMinutes = 40,
        priceMinor = 50_000,
        branchOverrides = overrides,
    )

    @Test
    @DisplayName("Hizmet oluşturuluyor, varsayılanlar sunucununki ve tabloya yazılıyor")
    fun createsWithDefaults() =
        runTest {
            val created = service.createService(input())

            assertEquals(0, created.bufferBeforeMinutes)
            assertEquals(2000, created.vatRateBasisPoints)
            assertTrue(created.isOnlineBookable && created.isActive)
            assertTrue(service.snapshotServices().any { it.id == created.id }, "Diğer mock'lar yeni hizmeti görmeli")
        }

    @Test
    @DisplayName("Slug çakışması 409 CONFLICT — büyük/küçük harf farkı kurtarmıyor")
    fun duplicateSlugConflicts() =
        runTest {
            val error = assertThrows<ApiError.Problem> { service.createService(input(slug = "LAZER-EPILASYON")) }
            assertEquals(ApiErrorCode.CONFLICT, error.problem.code)
        }

    @Test
    @DisplayName("Aktif hizmeti olan kategori pasife ALINAMAZ; boşalınca alınabiliyor")
    fun categoryInUseCannotBeDeactivated() =
        runTest {
            val error = assertThrows<ApiError.Problem> { service.deactivateCategory(MockIds.CATEGORY_INJECTION) }
            assertEquals(ApiErrorCode.CONFLICT, error.problem.code)

            service.deactivateService(MockIds.SERVICE_FILLER)
            val category = service.deactivateCategory(MockIds.CATEGORY_INJECTION)
            assertFalse(category.isActive)
        }

    @Test
    @DisplayName("Şube farkları TAM değiştiriliyor: verilmeyen korunur, boş liste hepsini siler")
    fun overridesAreReplacedWholesale() =
        runTest {
            val untouched = service.updateService(MockIds.SERVICE_LASER, UpdateServiceInput(name = "Lazer"))
            assertEquals(1, untouched.branchOverrides.size, "null liste dokunma demek")

            val cleared =
                service.updateService(MockIds.SERVICE_LASER, UpdateServiceInput(branchOverrides = emptyList()))
            assertTrue(cleared.branchOverrides.isEmpty())
        }

    @Test
    @DisplayName("Patch.Clear açıklamayı ve rengi siliyor, Unchanged dokunmuyor")
    fun patchClearsFields() =
        runTest {
            val cleared =
                service.updateService(MockIds.SERVICE_LASER, UpdateServiceInput(calendarColor = Patch.Clear))
            assertNull(cleared.calendarColor)

            val kept = service.updateService(MockIds.SERVICE_LASER, UpdateServiceInput(description = Patch.Set("Not")))
            assertNull(kept.calendarColor, "Unchanged, önceki temizliği geri getirmez")
            assertEquals("Not", kept.description)
        }

    @Test
    @DisplayName("Bilinmeyen kategoriye hizmet 404; pasife alma kaydı DÖNDÜRÜYOR (204 değil)")
    fun notFoundAndDeactivateReturnsRecord() =
        runTest {
            val error =
                assertThrows<ApiError.Problem> {
                    service.createService(input().copy(categoryId = "yok"))
                }
            assertEquals(ApiErrorCode.NOT_FOUND, error.problem.code)

            val deactivated = service.deactivateService(MockIds.SERVICE_SKIN_CARE)
            assertEquals(MockIds.SERVICE_SKIN_CARE, deactivated.id)
            assertFalse(deactivated.isActive)
        }

    @Test
    @DisplayName("Kategoriler sortOrder'a göre sıralı dönüyor")
    fun categoriesSorted() =
        runTest {
            service.updateCategory(MockIds.CATEGORY_SKIN_CARE, UpdateServiceCategoryInput(sortOrder = 9))
            assertEquals(MockIds.CATEGORY_SKIN_CARE, service.categories().last().id)
        }
}
