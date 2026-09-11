package com.klinara.android.features.catalog

import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.MockIds
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

class ServiceFormTest {
    private val laser = MockCatalogService.ALL.first { it.id == MockIds.SERVICE_LASER }

    @Test
    @DisplayName("Yeni hizmette slug addan türetiliyor; elle yazılınca türetme duruyor")
    fun slugDerivation() {
        val derived = ServiceForm.empty(MockIds.CATEGORY_SKIN_CARE).withName("Tüm Vücut Lazer")
        assertEquals("tum-vucut-lazer", derived.slug)

        val custom = derived.withSlug("lazer-x").withName("Başka ad")
        assertEquals("lazer-x", custom.slug)
    }

    @Test
    @DisplayName("Düzenlemede slug addan türetilmiyor")
    fun editingKeepsSlug() {
        val form = ServiceForm.of(laser).withName("Yeni ad")
        assertEquals(laser.slug, form.slug)
    }

    @Test
    @DisplayName("Geçerlilik: ad, geçerli slug, kategori ve fiyat şart; sıfır fiyat GEÇERLİ")
    fun validity() {
        val base = ServiceForm.empty(MockIds.CATEGORY_SKIN_CARE).withName("Kontrol")
        assertFalse(base.isValid, "Fiyat girilmedi")
        assertTrue(base.copy(priceMinor = 0).isValid)
        assertFalse(base.copy(priceMinor = 0, categoryId = "").isValid)
        assertFalse(base.copy(priceMinor = 0).withSlug("A!").isValid)
        assertEquals(ServiceForm.SLUG_HINT, base.withSlug("A!").slugError)
    }

    @Test
    @DisplayName("Güncelleme yalnız değişeni gönderiyor; rengi kaldırmak açık TEMİZLEME")
    fun updateSendsOnlyChanges() {
        val form = ServiceForm.of(laser)
        assertFalse(form.isDirty)
        assertTrue(form.updateInput().isEmpty)

        val input = form.copy(calendarColor = null, durationMinutes = 50).updateInput()
        assertEquals(Patch.Clear, input.calendarColor)
        assertEquals(50, input.durationMinutes)
        assertNull(input.priceMinor)
        assertNull(input.branchOverrides, "Farklar değişmedi — liste gönderilmez")
    }

    @Test
    @DisplayName("Şube farkı: fiyat eklenince liste gönderiliyor, iki alan da boşalınca satır düşüyor")
    fun overrideEditing() {
        val form = ServiceForm.of(laser)
        val bodrum = MockIds.BRANCH_BODRUM
        val nisantasi = MockIds.BRANCH_NISANTASI

        val added = form.withOverridePrice(nisantasi, 150_000)
        assertEquals(2, added.updateInput().branchOverrides?.size)

        // Bodrum'un süre ve fiyatı temizlenince satır listeden çıkar — değer taşımayan satır 400.
        val removed = form.withOverridePrice(bodrum, null).withOverrideDuration(bodrum, null)
        assertNull(removed.override(bodrum))
        assertEquals(emptyList<Any>(), removed.updateInput().branchOverrides)
    }

    @Test
    @DisplayName("Oluşturma gövdesi boş açıklamayı göndermiyor, override'ları taşıyor")
    fun createInput() {
        val input =
            ServiceForm
                .empty(MockIds.CATEGORY_SKIN_CARE)
                .withName("Maske")
                .copy(priceMinor = 10_000, description = "  ")
                .withOverrideDuration(MockIds.BRANCH_BODRUM, 45)
                .createInput()

        assertNull(input.description)
        assertEquals("maske", input.slug)
        assertEquals(45, input.branchOverrides.single().durationMinutes)
    }

    @Test
    @DisplayName("Toplam takvim süresi tamponları içeriyor")
    fun occupied() {
        assertEquals(5 + 45 + 10, ServiceForm.of(laser).occupiedMinutes)
    }
}
