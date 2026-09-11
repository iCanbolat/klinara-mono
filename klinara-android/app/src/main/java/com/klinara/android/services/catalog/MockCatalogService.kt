package com.klinara.android.services.catalog

import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.random.Random

/**
 * Mock hizmet kataloğu — A7.1'den beri **yazılabilir** bir tablo.
 *
 * Kimlikler ve süreler [MockIds] ile `MockBookingSeed`'in şablonlarıyla **aynı**:
 * tohumdaki bir randevunun hizmeti katalogda bulunamazsa rezervasyon formu var olan bir
 * randevuyu erteleyemez.
 *
 * Sunucunun **davranışını** taklit eder: slug çakışması 409, bilinmeyen kayıt 404, aktif
 * hizmeti olan kategori pasife alınamaz (409), `branchOverrides` tam değiştirme, boş
 * override satırı reddedilir. Mock'un bu kuralları atlaması, canlıda ilk denemede çıkan bir
 * hataya dönüşürdü.
 *
 * Diğer mock'lar (randevu motoru, paketler) tabloyu [snapshotServices] ile okur: pasife
 * alınan hizmet rezervasyon formundan düşer, yeni hizmet orada görünür.
 *
 * Eşzamanlılık: her metodun tek askıya alma noktası baştaki [settle]; tablolar ondan
 * SONRA askıya alınmadan okunup yazılıyor, yani ana iş parçacığında atomik.
 */
@Suppress("TooManyFunctions")
class MockCatalogService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
) : CatalogService {
    var failing: Boolean = false

    private val categoryRecords: MutableList<ServiceCategory> = CATEGORIES.toMutableList()
    private val serviceRecords: MutableList<ClinicService> = ALL.toMutableList()
    private var idCounter: Int = 0

    /** Diğer mock'lar için askıya almadan okunur kopya. */
    fun snapshotServices(): List<ClinicService> = serviceRecords.toList()

    fun snapshotCategories(): List<ServiceCategory> = categoryRecords.toList()

    // --- Kategoriler ---

    override suspend fun categories(): List<ServiceCategory> {
        settle()
        return categoryRecords.sortedWith(compareBy<ServiceCategory> { it.sortOrder }.thenBy { it.name })
    }

    override suspend fun createCategory(input: CreateServiceCategoryInput): ServiceCategory {
        settle()
        ensureUniqueCategorySlug(input.slug, exceptId = null)
        val created =
            ServiceCategory(
                id = nextId(CATEGORY_PREFIX),
                tenantId = MockIds.TENANT_NISANTASI,
                slug = input.slug,
                name = input.name,
                sortOrder = input.sortOrder ?: 0,
                isActive = input.isActive ?: true,
                createdAt = Instant.now(),
            )
        categoryRecords += created
        return created
    }

    override suspend fun updateCategory(
        id: String,
        input: UpdateServiceCategoryInput,
    ): ServiceCategory {
        settle()
        val old = category(id)
        input.slug?.let { ensureUniqueCategorySlug(it, exceptId = id) }
        if (input.isActive == false && old.isActive) ensureCategoryNotInUse(id)
        val updated =
            old.copy(
                slug = input.slug ?: old.slug,
                name = input.name ?: old.name,
                sortOrder = input.sortOrder ?: old.sortOrder,
                isActive = input.isActive ?: old.isActive,
            )
        categoryRecords.replace(updated) { it.id == id }
        return updated
    }

    override suspend fun deactivateCategory(id: String): ServiceCategory {
        settle()
        val old = category(id)
        ensureCategoryNotInUse(id)
        val updated = old.copy(isActive = false)
        categoryRecords.replace(updated) { it.id == id }
        return updated
    }

    // --- Hizmetler ---

    override suspend fun services(): List<ClinicService> {
        settle()
        return serviceRecords.sortedBy { it.name }
    }

    override suspend fun service(id: String): ClinicService {
        settle()
        return serviceRecords.firstOrNull { it.id == id } ?: throw MockErrors.notFound("Hizmet")
    }

    override suspend fun createService(input: CreateServiceInput): ClinicService {
        settle()
        ensureUniqueServiceSlug(input.slug, exceptId = null)
        category(input.categoryId)
        val id = nextId(SERVICE_PREFIX)
        val created =
            ClinicService(
                id = id,
                tenantId = MockIds.TENANT_NISANTASI,
                categoryId = input.categoryId,
                slug = input.slug,
                name = input.name,
                description = input.description,
                durationMinutes = input.durationMinutes,
                bufferBeforeMinutes = input.bufferBeforeMinutes ?: 0,
                bufferAfterMinutes = input.bufferAfterMinutes ?: 0,
                priceMinor = input.priceMinor,
                vatRateBasisPoints = input.vatRateBasisPoints ?: DEFAULT_VAT,
                calendarColor = input.calendarColor,
                isOnlineBookable = input.isOnlineBookable ?: true,
                isActive = input.isActive ?: true,
                createdAt = Instant.now(),
                branchOverrides = overrides(id, input.branchOverrides),
            )
        serviceRecords += created
        return created
    }

    override suspend fun updateService(
        id: String,
        input: UpdateServiceInput,
    ): ClinicService {
        settle()
        val old = serviceRecords.firstOrNull { it.id == id } ?: throw MockErrors.notFound("Hizmet")
        input.slug?.let { ensureUniqueServiceSlug(it, exceptId = id) }
        input.categoryId?.let { category(it) }
        val updated =
            old.merged(input).copy(
                // Sunucu gibi: verilirse TAM değiştirme, verilmezse dokunma.
                branchOverrides = input.branchOverrides?.let { overrides(id, it) } ?: old.branchOverrides,
            )
        serviceRecords.replace(updated) { it.id == id }
        return updated
    }

    /** Sunucu gibi: hizmet için kullanım kontrolü YOK — geçmiş randevular kayda bağlı kalır. */
    override suspend fun deactivateService(id: String): ClinicService {
        settle()
        val old = serviceRecords.firstOrNull { it.id == id } ?: throw MockErrors.notFound("Hizmet")
        val updated = old.copy(isActive = false)
        serviceRecords.replace(updated) { it.id == id }
        return updated
    }

    // --- Kurallar ---

    private fun category(id: String): ServiceCategory =
        categoryRecords.firstOrNull { it.id == id } ?: throw MockErrors.notFound("Hizmet kategorisi")

    private fun ensureUniqueCategorySlug(
        slug: String,
        exceptId: String?,
    ) {
        if (categoryRecords.any { it.id != exceptId && it.slug.equals(slug, ignoreCase = true) }) {
            throw MockErrors.conflict("Çakışma", "Bu hizmet kategorisi kodu zaten kullanımda")
        }
    }

    private fun ensureUniqueServiceSlug(
        slug: String,
        exceptId: String?,
    ) {
        if (serviceRecords.any { it.id != exceptId && it.slug.equals(slug, ignoreCase = true) }) {
            throw MockErrors.conflict("Çakışma", "Bu hizmet kodu zaten kullanımda")
        }
    }

    /** Sunucunun metni: `catalog.service.ts` — "Kullanımda olan hizmet kategorisi pasife alınamaz". */
    private fun ensureCategoryNotInUse(id: String) {
        if (serviceRecords.any { it.categoryId == id && it.isActive }) {
            throw MockErrors.conflict("Kullanımda olan hizmet kategorisi pasife alınamaz")
        }
    }

    private fun overrides(
        serviceId: String,
        inputs: List<BranchServiceOverrideInput>,
    ): List<BranchServiceOverride> {
        if (inputs.map { it.branchId }.toSet().size != inputs.size) {
            throw MockErrors.conflict("Çakışma", "Bu hizmet kodu zaten kullanımda")
        }
        return inputs.filterNot { it.isEmpty }.map { input ->
            BranchServiceOverride(
                id = nextId(OVERRIDE_PREFIX),
                serviceId = serviceId,
                branchId = input.branchId,
                durationMinutes = input.durationMinutes,
                bufferBeforeMinutes = input.bufferBeforeMinutes,
                bufferAfterMinutes = input.bufferAfterMinutes,
                priceMinor = input.priceMinor,
                vatRateBasisPoints = input.vatRateBasisPoints,
                isOnlineBookable = input.isOnlineBookable,
                isActive = input.isActive,
            )
        }
    }

    private fun nextId(prefix: String): String {
        idCounter += 1
        return "$prefix-0000-4000-8000-%012d".format(NEW_ID_BASE + idCounter)
    }

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    companion object {
        /**
         * Tohum — çalışma verisi DEĞİL. Çalışma verisi örnekte ([snapshotServices]); bu liste
         * paket ve randevu TOHUMLARININ ad/fiyat türettiği sabit başlangıç.
         */
        val ALL: List<ClinicService> =
            listOf(
                service(
                    MockIds.SERVICE_SKIN_CARE, "cilt-bakimi", "Cilt bakımı", MockIds.CATEGORY_SKIN_CARE,
                    minutes = 60, price = 90_000, color = "#7F9A76",
                ),
                service(
                    MockIds.SERVICE_LASER, "lazer-epilasyon", "Lazer epilasyon", MockIds.CATEGORY_EPILATION,
                    minutes = 45, price = 145_000, color = "#3F6E8C",
                    // Bodrum'da daha uzun ve pahalı: "Şubeye özel" rozeti ve şube farkları
                    // kartı ancak bir override varsa sürülebilir.
                    overrides =
                        listOf(
                            BranchServiceOverride(
                                id = "0e0e0000-0000-4000-8000-000000000001",
                                serviceId = MockIds.SERVICE_LASER,
                                branchId = MockIds.BRANCH_BODRUM,
                                durationMinutes = 60,
                                priceMinor = 165_000,
                            ),
                        ),
                ),
                service(
                    MockIds.SERVICE_FILLER, "dolgu", "Dolgu", MockIds.CATEGORY_INJECTION,
                    minutes = 90, price = 480_000, color = "#6B5B95", isOnline = false,
                ),
                service(
                    MockIds.SERVICE_CHECKUP, "kontrol", "Kontrol", MockIds.CATEGORY_SKIN_CARE,
                    minutes = 30, price = 0,
                ),
                // Pasif bir hizmet BİLEREK: form pasifleri gizliyor ve bu ancak
                // katalogda bir pasif kayıt varsa sürülebilir.
                service(
                    MockIds.SERVICE_MASK, "maske", "Maske", MockIds.CATEGORY_SKIN_CARE,
                    minutes = 30, price = 35_000, isActive = false,
                ),
            )

        val CATEGORIES: List<ServiceCategory> =
            listOf(
                ServiceCategory(MockIds.CATEGORY_SKIN_CARE, MockIds.TENANT_NISANTASI, "cilt-bakimi", "Cilt Bakımı", 0),
                ServiceCategory(MockIds.CATEGORY_EPILATION, MockIds.TENANT_NISANTASI, "epilasyon", "Epilasyon", 1),
                ServiceCategory(
                    MockIds.CATEGORY_INJECTION, MockIds.TENANT_NISANTASI, "enjeksiyon", "Enjeksiyon İşlemleri", 2,
                ),
            )

        private const val MIN_LATENCY_MILLIS = 120L
        private const val MAX_LATENCY_MILLIS = 400L
        private const val BUFFER_BEFORE = 5
        private const val BUFFER_AFTER = 10
        private const val DEFAULT_VAT = 2000
        private const val NEW_ID_BASE = 900
        private const val CATEGORY_PREFIX = "ca7e0000"
        private const val SERVICE_PREFIX = "5e111ce0"
        private const val OVERRIDE_PREFIX = "0e0e0000"

        @Suppress("LongParameterList")
        private fun service(
            id: String,
            slug: String,
            name: String,
            categoryId: String,
            minutes: Int,
            price: Long,
            color: String? = null,
            isActive: Boolean = true,
            isOnline: Boolean = true,
            overrides: List<BranchServiceOverride> = emptyList(),
        ) = ClinicService(
            id = id,
            tenantId = MockIds.TENANT_NISANTASI,
            categoryId = categoryId,
            slug = slug,
            name = name,
            durationMinutes = minutes,
            bufferBeforeMinutes = BUFFER_BEFORE,
            bufferAfterMinutes = BUFFER_AFTER,
            priceMinor = price,
            vatRateBasisPoints = DEFAULT_VAT,
            calendarColor = color,
            isOnlineBookable = isOnline,
            isActive = isActive,
            branchOverrides = overrides,
        )
    }
}

private fun <T> MutableList<T>.replace(
    value: T,
    predicate: (T) -> Boolean,
) {
    val index = indexOfFirst(predicate)
    if (index >= 0) this[index] = value
}

/** `PATCH` birleştirmesi — verilmeyen alan eskisini korur. Şube farkları çağıranda. */
private fun ClinicService.merged(input: UpdateServiceInput): ClinicService =
    copy(
        categoryId = input.categoryId ?: categoryId,
        slug = input.slug ?: slug,
        name = input.name ?: name,
        description = input.description.resolve(description),
        durationMinutes = input.durationMinutes ?: durationMinutes,
        bufferBeforeMinutes = input.bufferBeforeMinutes ?: bufferBeforeMinutes,
        bufferAfterMinutes = input.bufferAfterMinutes ?: bufferAfterMinutes,
        priceMinor = input.priceMinor ?: priceMinor,
        vatRateBasisPoints = input.vatRateBasisPoints ?: vatRateBasisPoints,
        calendarColor = input.calendarColor.resolve(calendarColor),
        isOnlineBookable = input.isOnlineBookable ?: isOnlineBookable,
        isActive = input.isActive ?: isActive,
    )

private fun Patch<String>.resolve(old: String?): String? =
    when (this) {
        Patch.Unchanged -> old
        Patch.Clear -> null
        is Patch.Set -> value
    }
