package com.klinara.android.services.catalog

import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

class CatalogModelsTest {
    private fun <T> decode(
        path: String,
        deserializer: DeserializationStrategy<T>,
    ): T = KlinaraJson.decodeFromString(deserializer, Fixtures.read(path))

    private val bagdat = "b1000000-0000-4000-8000-000000000002"

    @Test
    @DisplayName("Hizmet şube farklarıyla çözülüyor; override'daki null MİRAS demek, sıfır değil")
    fun serviceDecodesWithOverride() {
        val service = decode("catalog/service.json", ClinicService.serializer())

        assertEquals("tum-vucut-lazer", service.slug)
        assertEquals(250_000L, service.priceMinor)
        val branch = service.effective(bagdat)
        assertEquals(75, branch.durationMinutes)
        assertEquals(285_000L, branch.priceMinor)
        // Override tamponu `null` → hizmetin kendi tamponu; sıfır değil.
        assertEquals(10, branch.bufferBeforeMinutes)
        assertEquals(10 + 75 + 15, branch.occupiedMinutes)
        assertFalse(branch.isOnlineBookable, "Override online'ı kapatıyor")
        assertTrue(branch.isOverridden)
        assertTrue(branch.isActive, "Override `isActive: null` → miras, pasif değil")
    }

    @Test
    @DisplayName("Override'ı olmayan şube kiracı genelini görüyor")
    fun effectiveWithoutOverride() {
        val service = decode("catalog/service.json", ClinicService.serializer())
        val other = service.effective("başka-şube")

        assertEquals(90, other.durationMinutes)
        assertEquals(250_000L, other.priceMinor)
        assertFalse(other.isOverridden)
    }

    @Test
    @DisplayName("Kategori ve liste zarfı çözülüyor; bilinmeyen alan çökertmiyor")
    fun categoryAndListDecode() {
        val category = decode("catalog/service-category.json", ServiceCategory.serializer())
        assertEquals(2, category.sortOrder)
        assertFalse(category.isActive)

        val list = decode("catalog/services-list.json", ListEnvelope.serializer(ClinicService.serializer()))
        val service = list.data.single()
        assertNull(service.description)
        assertNull(service.calendarColor)
        assertEquals(1000, service.vatRateBasisPoints)
    }

    @Test
    @DisplayName("Güncelleme gövdesi açıklama ve rengi açık null ile TEMİZLİYOR, dokunulmayanı hiç yazmıyor")
    fun updateClearsWithExplicitNull() {
        val body = UpdateServiceInput(description = Patch.Clear, calendarColor = Patch.Clear).toJson()

        assertEquals(JsonNull, body["description"])
        assertEquals(JsonNull, body["calendarColor"])
        assertFalse("name" in body)
        assertFalse("branchOverrides" in body, "null liste 'dokunma' demek — gövdede YOK")
    }

    @Test
    @DisplayName("Boş şube farkı listesi 'tümünü kaldır' diye gönderiliyor; boş override satırı atılıyor")
    fun overrideListSemantics() {
        val cleared = UpdateServiceInput(branchOverrides = emptyList()).toJson()
        assertEquals(0, cleared["branchOverrides"]?.jsonArray?.size)

        val withEmptyRow =
            UpdateServiceInput(
                branchOverrides =
                    listOf(BranchServiceOverrideInput(bagdat), BranchServiceOverrideInput("x", priceMinor = 1)),
            ).toJson()
        assertEquals(1, withEmptyRow["branchOverrides"]?.jsonArray?.size, "Değer taşımayan satır sunucuda 400")
        assertFalse(UpdateServiceInput(branchOverrides = emptyList()).isEmpty)
        assertTrue(UpdateServiceInput().isEmpty)
    }
}
