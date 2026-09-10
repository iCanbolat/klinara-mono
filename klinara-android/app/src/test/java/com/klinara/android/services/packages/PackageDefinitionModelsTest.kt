package com.klinara.android.services.packages

import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.Page
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

class PackageDefinitionModelsTest {
    private fun <T> decode(
        path: String,
        deserializer: kotlinx.serialization.DeserializationStrategy<T>,
    ): T = KlinaraJson.decodeFromString(deserializer, Fixtures.read(path))

    @Test
    @DisplayName("Tanım kalemleriyle çözülüyor ve indirim LİSTE ile SATIŞ farkından hesaplanıyor")
    fun definitionDecodesWithDiscount() {
        val definition = decode("packages/package-definition.json", PackageDefinition.serializer())

        assertEquals(12, definition.totalSessions)
        assertEquals(1_630_000L, definition.listPriceMinor)
        assertEquals(380_000L, definition.discountMinor)
        assertEquals(23, definition.discountPercent)
        // `revision` satış snapshot'ı, `version` If-Match — ayrı sayaçlar.
        assertEquals(1, definition.revision)
        assertEquals(4, definition.version)
        assertNull(definition.branchId)
        assertFalse(definition.isArchived)
    }

    @Test
    @DisplayName("Sayfa zarfı çözülüyor; null geçerlilik SÜRESİZ, bilinmeyen alan çökertmiyor")
    fun pageDecodes() {
        val page = decode("packages/package-definition-page.json", Page.serializer(PackageDefinition.serializer()))
        val definition = page.data.single()

        assertTrue(page.pageInfo.hasMore)
        assertEquals("eyJjIjoiMjAyNi0wOS0wNyJ9", page.pageInfo.nextCursor)
        // `null` ≠ `0`: süresiz paket. Sıfır göstermek "bugün yanıyor" demek olurdu.
        assertNull(definition.validityDays)
        assertNull(definition.description)
    }

    @Test
    @DisplayName("Liste satış fiyatından büyük değilse indirim NULL — '0 ₺ indirim' yazılmaz")
    fun noDiscountIsNull() {
        val definition =
            decode("packages/package-definition.json", PackageDefinition.serializer())
                .copy(totalPriceMinor = 1_630_000L)

        assertNull(definition.discountMinor)
        assertNull(definition.discountPercent)
    }

    @Test
    @DisplayName("Satılabilirlik: pasif/arşiv satılamaz, şube kısıtı yalnız o şubede")
    fun sellability() {
        val base = decode("packages/package-definition.json", PackageDefinition.serializer())

        assertTrue(base.isSellable("herhangi-bir-sube"), "branchId null = tüm şubeler")
        assertFalse(base.copy(isActive = false).isSellable(null))
        assertFalse(base.copy(deletedAt = java.time.Instant.EPOCH).isSellable(null))
        assertTrue(base.copy(branchId = "b1").isSellable("b1"))
        assertFalse(base.copy(branchId = "b1").isSellable("b2"))
    }

    @Test
    @DisplayName("PATCH: süresiz yapmak `validityDays: null` GÖNDERİR, dokunmamak hiç yazmaz")
    fun updateBodyDistinguishesClearFromUnchanged() {
        val cleared = UpdatePackageDefinitionInput(validityDays = Patch.Clear).toJson()
        val untouched = UpdatePackageDefinitionInput(name = "Yeni ad").toJson()
        val set = UpdatePackageDefinitionInput(validityDays = Patch.Set(180)).toJson()

        assertEquals(JsonNull, cleared["validityDays"])
        assertFalse(untouched.containsKey("validityDays"))
        // Sayı SAYI olarak gider; `"180"` sunucuda 400 alırdı.
        assertEquals(180, set["validityDays"]!!.jsonPrimitive.int)
        assertFalse(set["validityDays"]!!.jsonPrimitive.isString)
    }

    @Test
    @DisplayName("Oluşturma gövdesi kalemleri serviceId + quantity olarak taşıyor, fiyat TAŞIMIYOR")
    fun createBodyCarriesOnlyServiceAndQuantity() {
        val body =
            CreatePackageDefinitionInput(
                slug = "deneme-paket",
                name = "Deneme",
                totalPriceMinor = 100_000,
                items = listOf(PackageDefinitionItemInput("s1", 3)),
            ).toJson()

        val item = body["items"]!!.jsonArray.single() as kotlinx.serialization.json.JsonObject
        assertEquals(setOf("serviceId", "quantity"), item.keys)
        // Verilmeyen şube = tüm şubeler; `null` göndermek yerine alan hiç yok.
        assertFalse(body.containsKey("branchId"))
    }
}
