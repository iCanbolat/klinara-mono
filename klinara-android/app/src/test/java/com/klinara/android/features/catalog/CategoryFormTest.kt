package com.klinara.android.features.catalog

import com.klinara.android.services.catalog.MockCatalogService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

class CategoryFormTest {
    private val epilation = MockCatalogService.CATEGORIES[1]

    @Test
    @DisplayName("Yeni kategori listenin sonuna, türetilmiş slug ile")
    fun createInput() {
        val form = CategoryForm().withName("Enjeksiyon İşlemleri")
        val input = form.createInput(sortOrder = 3)

        assertEquals("enjeksiyon-islemleri", input.slug)
        assertEquals(3, input.sortOrder)
        assertTrue(form.isValid)
    }

    @Test
    @DisplayName("Düzenlemede yalnız değişen alan; hiçbir şey değişmediyse boş")
    fun updateInput() {
        val form = CategoryForm.of(epilation)
        assertFalse(form.isDirty)
        assertTrue(form.updateInput().isEmpty)

        val input = form.copy(isActive = false).updateInput()
        assertEquals(false, input.isActive)
        assertNull(input.name)
        assertNull(input.sortOrder, "Sıra formdan değil listeden değişir")
    }
}
