package com.klinara.android.services.packages

import com.klinara.android.services.catalog.CatalogService
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.PageInfo
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.random.Random

/**
 * Sunucu olmadan paket ekranlarını sürmek için bellek-içi paket servisi.
 *
 * Gerçek servisin **davranışını** taklit eder, yalnız verisini değil: slug çakışması
 * 409, bayat sürüm `VERSION_CONFLICT`, pasif hizmet kalem olamaz, satılmış tanım
 * arşivlenmez yalnız pasife alınır. Arayüz bu hatalara göre yazılıyor; mock'un onları
 * atlaması, canlıda ilk denemede çıkan bir hataya dönüşürdü (§5.1).
 *
 * Kalem fiyatı ve adı [catalog]'dan okunur — sunucu da `unitListPriceMinor`'ı katalogdan
 * join'liyor ve istemcinin gönderdiği fiyata güvenmiyor.
 *
 * Eşzamanlılık: her metodun tek askıya alma noktası baştaki [settle]; tablolar ondan
 * SONRA askıya alınmadan okunup yazılıyor, yani ana iş parçacığında atomik.
 */
class MockPackagesService(
    private val catalog: CatalogService = MockCatalogService(latencyEnabled = false),
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
) : PackagesService {
    var failing: Boolean = false

    private val definitionRecords: MutableList<PackageDefinition> = MockPackagesSeed.definitions().toMutableList()

    /**
     * Satışı yapılmış tanımlar. A5.2'de gerçek satış tablosuyla değişecek; bugün yalnız
     * `retireDefinition`'ın "satılmışsa arşivleme" kuralını sürülebilir kılıyor. Lazer
     * paketi seed'de satılmış sayılır — Ayşe'nin paketi ondan satıldı.
     */
    private val soldDefinitionIds: MutableSet<String> = mutableSetOf(MockPackagesSeed.DEFINITION_LASER_10)

    private var idCounter: Int = 0
    private var tick: Long = 0

    // --- Tanımlar ---

    override suspend fun definitions(query: PackageDefinitionQuery): Page<PackageDefinition> {
        settle()
        val rows =
            definitionRecords
                .asSequence()
                .filter { it.deletedAt == null }
                // Kapsam sorusu: şubeye özel VE tüm şubelerde geçerli tanımlar birlikte.
                .filter { query.branchId == null || it.branchId == null || it.branchId == query.branchId }
                .filter { query.serviceId == null || it.items.any { item -> item.serviceId == query.serviceId } }
                .filter { query.isActive == null || it.isActive == query.isActive }
                .sortedByDescending { it.createdAt }
                .toList()
        return Page(rows, PageInfo(nextCursor = null, hasMore = false))
    }

    override suspend fun definition(id: String): PackageDefinition {
        settle()
        return definitionRecords.firstOrNull { it.id == id } ?: throw MockErrors.notFound("Paket tanımı")
    }

    override suspend fun createDefinition(input: CreatePackageDefinitionInput): PackageDefinition {
        val services = catalog.services()
        settle()
        if (definitionRecords.any { it.slug == input.slug && it.deletedAt == null }) {
            throw MockErrors.conflict("Bu kod zaten kullanılıyor", "Başka bir paket aynı slug'ı taşıyor.")
        }
        validate(input.totalPriceMinor, input.validityDays, input.items)
        val items = resolveItems(input.items, services)
        val now = nextInstant()
        val created =
            PackageDefinition(
                id = nextId(),
                branchId = input.branchId,
                slug = input.slug,
                name = input.name,
                description = input.description,
                totalPriceMinor = input.totalPriceMinor,
                listPriceMinor = items.sumOf { it.listTotalMinor },
                validityDays = input.validityDays,
                isTransferable = input.isTransferable ?: true,
                isOnlineSellable = input.isOnlineSellable ?: false,
                isActive = input.isActive ?: true,
                items = items,
                createdAt = now,
                updatedAt = now,
            )
        definitionRecords.add(created)
        return created
    }

    override suspend fun updateDefinition(
        id: String,
        version: Int,
        input: UpdatePackageDefinitionInput,
    ): PackageDefinition {
        val services = catalog.services()
        settle()
        val index = definitionRecords.indexOfFirst { it.id == id }
        if (index < 0) throw MockErrors.notFound("Paket tanımı")
        val old = definitionRecords[index]
        if (old.version != version) throw MockErrors.versionConflict()

        val validity = input.validityDays.resolve(old.validityDays)
        validate(input.totalPriceMinor ?: old.totalPriceMinor, validity, input.items)
        val items = input.items?.let { resolveItems(it, services) } ?: old.items

        val updated =
            old.copy(
                name = input.name ?: old.name,
                description = input.description.resolve(old.description),
                totalPriceMinor = input.totalPriceMinor ?: old.totalPriceMinor,
                listPriceMinor = items.sumOf { it.listTotalMinor },
                validityDays = validity,
                isTransferable = input.isTransferable ?: old.isTransferable,
                isOnlineSellable = input.isOnlineSellable ?: old.isOnlineSellable,
                isActive = input.isActive ?: old.isActive,
                // Satışı etkileyen alan değiştiyse revizyon artar; satılmış paketler bundan
                // ETKİLENMEZ, snapshot'larıyla yaşarlar.
                revision = if (input.affectsSale) old.revision + 1 else old.revision,
                version = old.version + 1,
                items = items,
                updatedAt = nextInstant(),
            )
        definitionRecords[index] = updated
        return updated
    }

    override suspend fun retireDefinition(
        id: String,
        version: Int,
    ) {
        settle()
        val index = definitionRecords.indexOfFirst { it.id == id }
        if (index < 0) throw MockErrors.notFound("Paket tanımı")
        val old = definitionRecords[index]
        if (old.version != version) throw MockErrors.versionConflict()
        val now = nextInstant()
        // Satılmışsa arşivlenmez, yalnız pasife alınır — satış izi kopmasın.
        definitionRecords[index] =
            old.copy(
                isActive = false,
                version = old.version + 1,
                updatedAt = now,
                deletedAt = if (isSold(id)) null else now,
            )
    }

    // --- Yardımcılar ---

    private fun isSold(definitionId: String): Boolean = definitionId in soldDefinitionIds

    /**
     * Sunucudaki DTO doğrulamasının aynası — yol adları `FieldError.path` ile birebir.
     * İlk ihlali döndürür; çağıran fırlatır (tek `throw`, dört kural).
     */
    private fun validate(
        totalPriceMinor: Long,
        validityDays: Int?,
        items: List<PackageDefinitionItemInput>?,
    ) {
        val violation =
            when {
                totalPriceMinor < 0 -> "totalPriceMinor" to "Fiyat negatif olamaz."
                validityDays != null && validityDays < 1 ->
                    "validityDays" to "Geçerlilik en az 1 gün olmalı; süresiz için boş bırakın."
                items == null -> null
                items.isEmpty() -> "items" to "En az bir kalem gerekli."
                items.any { it.quantity < 1 } -> "items" to "Adet en az 1 olmalı."
                items.map { it.serviceId }.toSet().size != items.size -> "items" to "Aynı hizmet iki kez eklenemez."
                else -> null
            }
        violation?.let { (path, message) -> throw MockErrors.validation(path, message) }
    }

    private fun resolveItems(
        inputs: List<PackageDefinitionItemInput>,
        services: List<ClinicService>,
    ): List<PackageDefinitionItem> =
        inputs.mapIndexed { position, input ->
            val service =
                services.firstOrNull { it.id == input.serviceId }
                    ?: throw MockErrors.validation("items", "Hizmet bulunamadı.")
            if (!service.isActive) throw MockErrors.validation("items", "Pasif hizmet pakete eklenemez.")
            PackageDefinitionItem(
                id = nextId(),
                serviceId = service.id,
                serviceName = service.name,
                quantity = input.quantity,
                unitListPriceMinor = service.priceMinor,
                sortOrder = position,
            )
        }

    private fun <T> Patch<T>.resolve(old: T?): T? =
        when (this) {
            Patch.Unchanged -> old
            Patch.Clear -> null
            is Patch.Set -> value
        }

    private fun nextId(): String = "f9000000-0000-4000-8000-%012d".format(++idCounter)

    /** Monotonik: oluşturulan kayıtlar deterministik sıralansın. */
    private fun nextInstant(): Instant = MockPackagesSeed.SEED_NOW.plusSeconds(++tick)

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    private companion object {
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
    }
}
