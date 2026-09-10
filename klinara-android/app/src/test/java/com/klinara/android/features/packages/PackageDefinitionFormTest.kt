package com.klinara.android.features.packages

import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.packages.MockPackagesSeed
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

class PackageDefinitionFormTest {
    private val laser = MockCatalogService.ALL.first { it.id == MockIds.SERVICE_LASER }
    private val skin = MockCatalogService.ALL.first { it.id == MockIds.SERVICE_SKIN_CARE }
    private val seeded = MockPackagesSeed.definitions().first { it.id == MockPackagesSeed.DEFINITION_LASER_10 }

    @Test
    @DisplayName("Ad yazıldıkça slug TÜRKÇE kurallarla türüyor; elle dokunulunca türetme duruyor")
    fun slugFollowsNameUntilEdited() {
        val derived = PackageDefinitionForm.empty().withName("Işıl Özel Bakım")
        val custom = derived.withSlug("ozel-kod").withName("Başka ad")

        assertEquals("isil-ozel-bakim", derived.slug)
        assertEquals("ozel-kod", custom.slug)
    }

    @Test
    @DisplayName("Kalem, fiyat ve geçerli slug olmadan form geçersiz; aynı hizmet iki kez eklenmiyor")
    fun validity() {
        val empty = PackageDefinitionForm.empty().withName("Paket")
        val complete = empty.adding(laser, null).copy(totalPriceMinor = 100_000)

        assertFalse(empty.isValid)
        assertTrue(complete.isValid)
        assertEquals(1, complete.adding(laser, null).items.size)
        assertFalse(complete.copy(validityDays = 0).isValid, "0 gün geçersiz; süresiz = null")
    }

    @Test
    @DisplayName("İndirim önizlemesi liste toplamı ile satış fiyatı farkı; fark yoksa NULL")
    fun discountPreview() {
        val form =
            PackageDefinitionForm.empty()
                .withName("P")
                .adding(laser, null)
                .withQuantity(laser.id, 10)
                .adding(skin, null)
                .withQuantity(skin.id, 2)

        assertEquals(1_630_000L, form.listPriceMinor)
        assertEquals(380_000L, form.copy(totalPriceMinor = 1_250_000).discountMinor)
        assertNull(form.copy(totalPriceMinor = 2_000_000).discountMinor)
    }

    @Test
    @DisplayName("Düzenlemede yalnız DEĞİŞEN alanlar gider; süresiz yapmak açık TEMİZLEME")
    fun updateSendsOnlyChanges() {
        val form = PackageDefinitionForm.of(seeded)

        assertFalse(form.isDirty)
        assertTrue(form.updateInput().isEmpty)

        val input = form.copy(validityDays = null).updateInput()
        assertEquals(Patch.Clear, input.validityDays)
        assertNull(input.name)
        assertNull(input.items, "Kalemler değişmediyse liste gönderilmez")
    }

    @Test
    @DisplayName("Düzenlemede slug ad değişince TÜREMİYOR — satılmış paketlerin izi")
    fun editingLocksSlug() {
        val form = PackageDefinitionForm.of(seeded).withName("Yepyeni ad")

        assertEquals(seeded.slug, form.slug)
        assertTrue(form.isDirty)
    }
}
