package com.klinara.android.features.catalog

import com.klinara.android.services.catalog.CreateServiceCategoryInput
import com.klinara.android.services.catalog.ServiceCategory
import com.klinara.android.services.catalog.UpdateServiceCategoryInput
import com.klinara.android.services.formatting.Slug

/**
 * Kategori formu — saf değer tipi. iOS `CategoryEditorSheet`'in durumu.
 *
 * `sortOrder` burada YOK: sıra listede yukarı/aşağı ile değişir, formda bir sayı alanı
 * olarak değil (iOS gibi).
 */
data class CategoryForm(
    val id: String? = null,
    val name: String = "",
    val slug: String = "",
    val isActive: Boolean = true,
    private val slugIsCustom: Boolean = false,
    private val original: CategoryForm? = null,
) {
    val isEditing: Boolean get() = id != null

    val isDirty: Boolean get() = original == null || comparable() != original.comparable()

    val slugError: String? get() = if (slug.isEmpty() || Slug.isValid(slug)) null else ServiceForm.SLUG_HINT

    val isValid: Boolean get() = name.isNotBlank() && Slug.isValid(slug)

    fun withName(value: String): CategoryForm =
        copy(name = value, slug = if (slugIsCustom || isEditing) slug else Slug.make(value))

    fun withSlug(value: String): CategoryForm = copy(slug = value, slugIsCustom = value != Slug.make(name))

    /** Yeni kategori listenin SONUNA eklenir (iOS: `sortOrder = categories.count`). */
    fun createInput(sortOrder: Int): CreateServiceCategoryInput =
        CreateServiceCategoryInput(slug = slug, name = name.trim(), sortOrder = sortOrder, isActive = isActive)

    fun updateInput(): UpdateServiceCategoryInput {
        val base = original ?: return UpdateServiceCategoryInput()
        return UpdateServiceCategoryInput(
            slug = slug.takeIf { it != base.slug },
            name = name.trim().takeIf { it != base.name },
            isActive = isActive.takeIf { it != base.isActive },
        )
    }

    private fun comparable() = copy(original = null, slugIsCustom = false)

    companion object {
        fun of(category: ServiceCategory): CategoryForm {
            val form =
                CategoryForm(
                    id = category.id,
                    name = category.name,
                    slug = category.slug,
                    isActive = category.isActive,
                    slugIsCustom = true,
                )
            return form.copy(original = form)
        }
    }
}
