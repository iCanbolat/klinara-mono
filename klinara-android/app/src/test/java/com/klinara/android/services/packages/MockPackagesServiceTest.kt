package com.klinara.android.services.packages

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * Mock'un sunucu kurallarını taklit ettiğini çiviler.
 *
 * Mock'ta geçen bir akışın canlıda patlaması, mock'un hiç olmamasından kötüdür.
 */
class MockPackagesServiceTest {
    private fun subject() = MockPackagesService(latencyEnabled = false)

    private suspend fun codeOf(block: suspend () -> Unit): ApiErrorCode? =
        try {
            block()
            null
        } catch (error: ApiError) {
            error.code
        }

    private fun createInput(slug: String = "yeni-paket") =
        CreatePackageDefinitionInput(
            slug = slug,
            name = "Yeni paket",
            totalPriceMinor = 300_000,
            items = listOf(PackageDefinitionItemInput(MockIds.SERVICE_LASER, 3)),
        )

    @Test
    @DisplayName("Oluşturma kalem fiyatını KATALOGDAN alıyor ve liste toplamını hesaplıyor")
    fun createResolvesPricesFromCatalog() =
        runTest {
            val created = subject().createDefinition(createInput())

            assertEquals("Lazer epilasyon", created.items.single().serviceName)
            assertEquals(145_000L, created.items.single().unitListPriceMinor)
            assertEquals(435_000L, created.listPriceMinor)
            assertEquals(1, created.version)
        }

    @Test
    @DisplayName("Tekrar eden slug 409 CONFLICT veriyor ve liste bozulmuyor")
    fun duplicateSlugConflicts() =
        runTest {
            val service = subject()
            val before = service.definitions().data.size

            val code = codeOf { service.createDefinition(createInput(slug = "lazer-10-seans")) }

            assertEquals(ApiErrorCode.CONFLICT, code)
            assertEquals(before, service.definitions().data.size)
        }

    @Test
    @DisplayName("Pasif hizmet ve tekrar eden hizmet kalem olamaz — 400")
    fun invalidItemsRejected() =
        runTest {
            val service = subject()
            val inactive =
                codeOf {
                    service.createDefinition(
                        createInput().copy(items = listOf(PackageDefinitionItemInput(MockIds.SERVICE_MASK, 1))),
                    )
                }
            val duplicate =
                codeOf {
                    service.createDefinition(
                        createInput().copy(
                            items =
                                listOf(
                                    PackageDefinitionItemInput(MockIds.SERVICE_LASER, 1),
                                    PackageDefinitionItemInput(MockIds.SERVICE_LASER, 2),
                                ),
                        ),
                    )
                }

            assertEquals(ApiErrorCode.VALIDATION_FAILED, inactive)
            assertEquals(ApiErrorCode.VALIDATION_FAILED, duplicate)
        }

    @Test
    @DisplayName("Bayat sürümle güncelleme VERSION_CONFLICT veriyor")
    fun staleVersionConflicts() =
        runTest {
            val service = subject()
            val definition = service.definition(MockPackagesSeed.DEFINITION_LASER_10)
            service.updateDefinition(definition.id, definition.version, UpdatePackageDefinitionInput(name = "İlk"))

            val code =
                codeOf {
                    service.updateDefinition(
                        definition.id,
                        definition.version,
                        UpdatePackageDefinitionInput(name = "İkinci"),
                    )
                }

            assertEquals(ApiErrorCode.VERSION_CONFLICT, code)
        }

    @Test
    @DisplayName("Satışı etkileyen alan REVİZYONU artırır; yalnız ad değişimi artırmaz")
    fun revisionBumpsOnlyOnSaleAffectingChanges() =
        runTest {
            val service = subject()
            val original = service.definition(MockPackagesSeed.DEFINITION_LASER_10)

            val renamed =
                service.updateDefinition(original.id, original.version, UpdatePackageDefinitionInput(name = "Ad"))
            val repriced =
                service.updateDefinition(renamed.id, renamed.version, UpdatePackageDefinitionInput(totalPriceMinor = 1))

            assertEquals(original.revision, renamed.revision)
            assertEquals(original.revision + 1, repriced.revision)
            assertEquals(original.version + 2, repriced.version)
        }

    @Test
    @DisplayName("Süresiz yapmak geçerliliği TEMİZLİYOR; 0 gün ise reddediliyor")
    fun validityClearVsZero() =
        runTest {
            val service = subject()
            val definition = service.definition(MockPackagesSeed.DEFINITION_LASER_10)

            val cleared =
                service.updateDefinition(
                    definition.id,
                    definition.version,
                    UpdatePackageDefinitionInput(validityDays = Patch.Clear),
                )
            val zero =
                codeOf {
                    service.updateDefinition(
                        cleared.id,
                        cleared.version,
                        UpdatePackageDefinitionInput(validityDays = Patch.Set(0)),
                    )
                }

            assertNull(cleared.validityDays)
            assertEquals(ApiErrorCode.VALIDATION_FAILED, zero)
        }

    @Test
    @DisplayName("Satılmış tanım emekliye ayrılınca ARŞİVLENMİYOR, yalnız pasife alınıyor")
    fun retiringSoldDefinitionOnlyDeactivates() =
        runTest {
            val service = subject()
            val sold = service.definition(MockPackagesSeed.DEFINITION_LASER_10)

            service.retireDefinition(sold.id, sold.version)
            val after = service.definition(sold.id)

            assertFalse(after.isActive)
            assertFalse(after.isArchived)
            assertTrue(service.definitions().data.any { it.id == sold.id }, "Pasif tanım listede kalır")
        }

    @Test
    @DisplayName("Satılmamış tanım emekliye ayrılınca ARŞİVLENİYOR ve listeden düşüyor")
    fun retiringUnsoldDefinitionArchives() =
        runTest {
            val service = subject()
            val created = service.createDefinition(createInput())

            service.retireDefinition(created.id, created.version)

            assertNotNull(service.definition(created.id).deletedAt)
            assertTrue(service.definitions().data.none { it.id == created.id })
        }

    @Test
    @DisplayName("Şube kapsamı DIŞLAMIYOR: kısıtsız tanım her kapsamda, kısıtlı yalnız kendi şubesinde")
    fun branchScopeIncludesUnscoped() =
        runTest {
            val service = subject()

            val nisantasi = service.definitions(PackageDefinitionQuery(branchId = MockIds.BRANCH_NISANTASI)).data
            val bodrum = service.definitions(PackageDefinitionQuery(branchId = MockIds.BRANCH_BODRUM)).data

            assertEquals(2, nisantasi.size)
            assertEquals(listOf(MockPackagesSeed.DEFINITION_LASER_10), bodrum.map { it.id })
        }
}
