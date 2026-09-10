package com.klinara.android.features.packages

import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.formatting.Slug
import com.klinara.android.services.packages.CreatePackageDefinitionInput
import com.klinara.android.services.packages.PackageDefinition
import com.klinara.android.services.packages.PackageDefinitionItemInput
import com.klinara.android.services.packages.UpdatePackageDefinitionInput

/**
 * Paket tanımı formunun durumu — **saf bir değer tipi** (`CustomerForm` deseni).
 *
 * Kurallar ekranda değil burada: geçerlilik, kirlilik, indirim önizlemesi ve iki ayrı
 * gövdenin (`Create`/`Update`) üretimi `@Composable` olmayan bir tipte durduğu için testi
 * ucuz ve oluşturma/düzenleme aynı yoldan sürülüyor. iOS `PackageDefinitionForm` paritesi.
 */
data class PackageDefinitionForm(
    val slug: String = "",
    val name: String = "",
    val description: String = "",
    val totalPriceMinor: Long? = null,
    /** `null` **tüm şubeler**. */
    val branchId: String? = null,
    /** `null` **süresiz** paket demektir; `0` değil. */
    val validityDays: Int? = null,
    val isTransferable: Boolean = true,
    val isOnlineSellable: Boolean = false,
    val isActive: Boolean = true,
    val items: List<Item> = emptyList(),
    /**
     * Düzenlemede slug ve şube KİLİTLİ: ikisi de satılmış paketlerin izini taşır ve sunucu
     * `PATCH` gövdesinde ikisini de reddeder.
     */
    val isEditing: Boolean = false,
    /** Kullanıcı slug'a elle dokunduysa ad değişince artık türetilmez. */
    private val slugIsCustom: Boolean = false,
    private val original: PackageDefinitionForm? = null,
) {
    /**
     * Kalemin form içindeki hâli. Sunucu gövdesi yalnız `serviceId` + `quantity` taşır ama
     * ekranın ada ve liste fiyatına da ihtiyacı var — indirim önizlemesi bunlarsız
     * hesaplanamaz.
     */
    data class Item(
        val serviceId: String,
        val serviceName: String,
        val unitListPriceMinor: Long,
        val quantity: Int,
    ) {
        val listTotalMinor: Long get() = unitListPriceMinor * quantity
    }

    // --- Türetilmiş ---

    val isDirty: Boolean get() = original == null || comparable() != original.comparable()

    val slugError: String?
        get() = if (slug.isEmpty() || SLUG_PATTERN.matches(slug)) null else SLUG_HINT

    val validityError: String?
        get() = validityDays?.takeIf { it < 1 }?.let { "En az 1 gün; süresiz için anahtarı kapatın." }

    /** Sunucu aynı hizmetin iki kez verilmesini reddediyor; ekranda söylemek 400'den dürüst. */
    val hasDuplicateService: Boolean get() = items.map { it.serviceId }.toSet().size != items.size

    val isValid: Boolean
        get() =
            name.isNotBlank() && SLUG_PATTERN.matches(slug) && totalPriceMinor != null &&
                items.isNotEmpty() && items.all { it.quantity > 0 } && !hasDuplicateService &&
                validityError == null

    val totalSessions: Int get() = items.sumOf { it.quantity }

    /** Kalemlerin GÜNCEL katalog fiyatları toplamı — sunucudaki `listPriceMinor` ile aynı hesap. */
    val listPriceMinor: Long get() = items.sumOf { it.listTotalMinor }

    /** `null` indirim yok demek; sıfır göstermek "indirim var ama 0 ₺" gibi okunurdu. */
    val discountMinor: Long?
        get() = totalPriceMinor?.let { price -> (listPriceMinor - price).takeIf { it > 0 } }

    // --- Düzenleme ---

    fun withName(value: String): PackageDefinitionForm =
        copy(name = value, slug = if (slugIsCustom || isEditing) slug else Slug.make(value))

    fun withSlug(value: String): PackageDefinitionForm =
        copy(slug = value, slugIsCustom = value != Slug.make(name))

    fun adding(
        service: ClinicService,
        branchId: String?,
    ): PackageDefinitionForm {
        if (items.any { it.serviceId == service.id }) return this
        val item =
            Item(
                serviceId = service.id,
                serviceName = service.name,
                // Şubenin geçerli fiyatı — indirim önizlemesi seçili şubeye göre doğru olsun.
                unitListPriceMinor = service.effective(branchId).priceMinor,
                quantity = 1,
            )
        return copy(items = items + item)
    }

    fun removing(serviceId: String): PackageDefinitionForm = copy(items = items.filterNot { it.serviceId == serviceId })

    fun withQuantity(
        serviceId: String,
        quantity: Int,
    ): PackageDefinitionForm =
        copy(items = items.map { if (it.serviceId == serviceId) it.copy(quantity = quantity) else it })

    // --- Sunucu gövdeleri ---

    private val wireItems: List<PackageDefinitionItemInput>
        get() = items.map { PackageDefinitionItemInput(it.serviceId, it.quantity) }

    fun createInput(): CreatePackageDefinitionInput =
        CreatePackageDefinitionInput(
            slug = slug,
            name = name.trim(),
            totalPriceMinor = totalPriceMinor ?: 0,
            items = wireItems,
            description = description.trim().ifEmpty { null },
            branchId = branchId,
            validityDays = validityDays,
            isTransferable = isTransferable,
            isOnlineSellable = isOnlineSellable,
            isActive = isActive,
        )

    /**
     * Güncelleme gövdesi — yalnız DEĞİŞEN alanlar.
     *
     * Kalem listesi değiştiyse **tamamı** gönderilir: sunucu verilen listeyle tamamen
     * değiştiriyor. "Süresiz" seçildiyse `validityDays` açıkça TEMİZLENİR; gönderilmemesi
     * eski süreyi olduğu gibi bırakırdı.
     */
    fun updateInput(): UpdatePackageDefinitionInput {
        val base = original ?: return UpdatePackageDefinitionInput()
        return UpdatePackageDefinitionInput(
            name = name.trim().takeIf { it != base.name },
            description = if (description.trim() != base.description) Patch.text(description) else Patch.Unchanged,
            totalPriceMinor = totalPriceMinor.takeIf { it != base.totalPriceMinor },
            validityDays = if (validityDays != base.validityDays) Patch.orClear(validityDays) else Patch.Unchanged,
            isTransferable = isTransferable.takeIf { it != base.isTransferable },
            isOnlineSellable = isOnlineSellable.takeIf { it != base.isOnlineSellable },
            isActive = isActive.takeIf { it != base.isActive },
            items = wireItems.takeIf { items != base.items },
        )
    }

    /** Kirlilik karşılaştırması `original`/`slugIsCustom`'u dışarıda bırakır. */
    private fun comparable() = copy(original = null, slugIsCustom = false)

    companion object {
        /** Sunucunun `SLUG_PATTERN`'i. */
        private val SLUG_PATTERN = Regex("^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$")
        private const val SLUG_HINT = "Yalnız küçük harf, rakam ve tire; 3-50 karakter."

        fun empty(branchId: String? = null): PackageDefinitionForm = PackageDefinitionForm(branchId = branchId)

        fun of(definition: PackageDefinition): PackageDefinitionForm {
            val form =
                PackageDefinitionForm(
                    slug = definition.slug,
                    name = definition.name,
                    description = definition.description.orEmpty(),
                    totalPriceMinor = definition.totalPriceMinor,
                    branchId = definition.branchId,
                    validityDays = definition.validityDays,
                    isTransferable = definition.isTransferable,
                    isOnlineSellable = definition.isOnlineSellable,
                    isActive = definition.isActive,
                    items =
                        definition.sortedItems.map {
                            Item(it.serviceId, it.serviceName, it.unitListPriceMinor, it.quantity)
                        },
                    isEditing = true,
                    slugIsCustom = true,
                )
            return form.copy(original = form)
        }
    }
}
