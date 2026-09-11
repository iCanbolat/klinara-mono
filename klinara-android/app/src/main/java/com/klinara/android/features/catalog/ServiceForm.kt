package com.klinara.android.features.catalog

import com.klinara.android.services.catalog.BranchServiceOverrideInput
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.catalog.CreateServiceInput
import com.klinara.android.services.catalog.UpdateServiceInput
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.formatting.Slug
import com.klinara.android.services.formatting.VatRate

/**
 * Hizmet formunun durumu — **saf bir değer tipi** (`PackageDefinitionForm` deseni).
 *
 * Kurallar ekranda değil burada: geçerlilik, kirlilik, slug türetme ve iki ayrı gövdenin
 * (`Create`/`Update`) üretimi. iOS `ServiceForm` paritesi; iki bilinçli farkla:
 *
 * 1. **Güncelleme yalnız DEĞİŞEN alanları gönderir** ve açıklama/renk [Patch] ile
 *    temizlenebilir. iOS her alanı gönderiyor ve `nil`'i gövdeden attığı için bir
 *    hizmetin rengini ya da açıklamasını kaldıramıyor.
 * 2. Şube farkları yalnız DEĞİŞTİYSE gönderilir — liste tam değiştirme ile yazılıyor ve
 *    her kayıtta yeniden yazmak, override kimliklerini boşuna yeniler.
 */
data class ServiceForm(
    val categoryId: String = "",
    val name: String = "",
    val slug: String = "",
    val description: String = "",
    val durationMinutes: Int = DEFAULT_DURATION,
    val bufferBeforeMinutes: Int = 0,
    val bufferAfterMinutes: Int = 0,
    /** `null` henüz girilmemiş; sıfır geçerli bir fiyattır (ücretsiz kontrol). */
    val priceMinor: Long? = null,
    val vatRateBasisPoints: Int = VatRate.TWENTY_PERCENT,
    val calendarColor: String? = null,
    val isOnlineBookable: Boolean = true,
    val isActive: Boolean = true,
    /**
     * Şube → fark. Ekran yalnız fiyat ve süreyi düzenler; sunucudan gelen diğer override
     * alanları (tampon, KDV, online, aktif) burada **korunur** ve aynen geri yazılır —
     * iOS'taki gibi, görünmeyen bir alanı kayıtta sessizce silmemek için.
     */
    val overrides: Map<String, BranchServiceOverrideInput> = emptyMap(),
    val isEditing: Boolean = false,
    /** Kullanıcı slug'a elle dokunduysa ad değişince artık türetilmez. */
    private val slugIsCustom: Boolean = false,
    private val original: ServiceForm? = null,
) {
    // --- Türetilmiş ---

    val isDirty: Boolean get() = original == null || comparable() != original.comparable()

    val slugError: String?
        get() = if (slug.isEmpty() || Slug.isValid(slug)) null else SLUG_HINT

    val occupiedMinutes: Int get() = bufferBeforeMinutes + durationMinutes + bufferAfterMinutes

    val isValid: Boolean
        get() =
            name.isNotBlank() && Slug.isValid(slug) && categoryId.isNotEmpty() && priceMinor != null &&
                durationMinutes in DURATION_RANGE && bufferBeforeMinutes in BUFFER_RANGE &&
                bufferAfterMinutes in BUFFER_RANGE

    fun override(branchId: String): BranchServiceOverrideInput? = overrides[branchId]?.takeUnless { it.isEmpty }

    // --- Düzenleme ---

    fun withName(value: String): ServiceForm =
        copy(name = value, slug = if (slugIsCustom || isEditing) slug else Slug.make(value))

    fun withSlug(value: String): ServiceForm = copy(slug = value, slugIsCustom = value != Slug.make(name))

    fun withOverridePrice(
        branchId: String,
        priceMinor: Long?,
    ): ServiceForm = withOverride(branchId) { it.copy(priceMinor = priceMinor) }

    fun withOverrideDuration(
        branchId: String,
        minutes: Int?,
    ): ServiceForm = withOverride(branchId) { it.copy(durationMinutes = minutes) }

    private fun withOverride(
        branchId: String,
        transform: (BranchServiceOverrideInput) -> BranchServiceOverrideInput,
    ): ServiceForm {
        val updated = transform(overrides[branchId] ?: BranchServiceOverrideInput(branchId))
        // Boşalan fark listeden çıkar: sunucu değer alanı taşımayan bir satırı reddediyor.
        return copy(overrides = if (updated.isEmpty) overrides - branchId else overrides + (branchId to updated))
    }

    // --- Sunucu gövdeleri ---

    private val wireOverrides: List<BranchServiceOverrideInput>
        get() = overrides.values.filterNot { it.isEmpty }.sortedBy { it.branchId }

    fun createInput(): CreateServiceInput =
        CreateServiceInput(
            categoryId = categoryId,
            slug = slug,
            name = name.trim(),
            durationMinutes = durationMinutes,
            priceMinor = priceMinor ?: 0,
            description = description.trim().ifEmpty { null },
            bufferBeforeMinutes = bufferBeforeMinutes,
            bufferAfterMinutes = bufferAfterMinutes,
            vatRateBasisPoints = vatRateBasisPoints,
            calendarColor = calendarColor,
            isOnlineBookable = isOnlineBookable,
            isActive = isActive,
            branchOverrides = wireOverrides,
        )

    /** Güncelleme gövdesi — yalnız DEĞİŞEN alanlar. */
    fun updateInput(): UpdateServiceInput {
        val base = original ?: return UpdateServiceInput()
        return UpdateServiceInput(
            categoryId = categoryId.takeIf { it != base.categoryId },
            slug = slug.takeIf { it != base.slug },
            name = name.trim().takeIf { it != base.name },
            description = if (description.trim() != base.description) Patch.text(description) else Patch.Unchanged,
            durationMinutes = durationMinutes.takeIf { it != base.durationMinutes },
            bufferBeforeMinutes = bufferBeforeMinutes.takeIf { it != base.bufferBeforeMinutes },
            bufferAfterMinutes = bufferAfterMinutes.takeIf { it != base.bufferAfterMinutes },
            priceMinor = priceMinor.takeIf { it != base.priceMinor },
            vatRateBasisPoints = vatRateBasisPoints.takeIf { it != base.vatRateBasisPoints },
            calendarColor =
                if (calendarColor != base.calendarColor) Patch.orClear(calendarColor) else Patch.Unchanged,
            isOnlineBookable = isOnlineBookable.takeIf { it != base.isOnlineBookable },
            isActive = isActive.takeIf { it != base.isActive },
            // Liste TAM değiştirme ile yazılıyor: değiştiyse tamamı, değişmediyse hiç.
            branchOverrides = wireOverrides.takeIf { it != base.wireOverrides },
        )
    }

    /** Kirlilik karşılaştırması `original`/`slugIsCustom`'u dışarıda bırakır; boş farklar sayılmaz. */
    private fun comparable() =
        copy(original = null, slugIsCustom = false, overrides = overrides.filterValues { !it.isEmpty })

    companion object {
        const val DEFAULT_DURATION = 60
        val DURATION_RANGE = 5..1440
        val BUFFER_RANGE = 0..240
        const val MINUTE_STEP = 5
        const val SLUG_HINT = "Yalnız küçük harf, rakam ve tire; 3-50 karakter."

        /** Yeni hizmet: varsayılan kategori sıradaki ilk AKTİF kategori (iOS gibi). */
        fun empty(categoryId: String = ""): ServiceForm = ServiceForm(categoryId = categoryId)

        fun of(service: ClinicService): ServiceForm {
            val form =
                ServiceForm(
                    categoryId = service.categoryId,
                    name = service.name,
                    slug = service.slug,
                    description = service.description.orEmpty(),
                    durationMinutes = service.durationMinutes,
                    bufferBeforeMinutes = service.bufferBeforeMinutes,
                    bufferAfterMinutes = service.bufferAfterMinutes,
                    priceMinor = service.priceMinor,
                    vatRateBasisPoints = service.vatRateBasisPoints,
                    calendarColor = service.calendarColor,
                    isOnlineBookable = service.isOnlineBookable,
                    isActive = service.isActive,
                    overrides = service.branchOverrides.associate { it.branchId to it.toInput() },
                    isEditing = true,
                    slugIsCustom = true,
                )
            return form.copy(original = form)
        }
    }
}
