package com.klinara.android.services.packages

import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.mock.MockIds
import java.time.Instant

/**
 * Mock paket verisinin başlangıç durumu.
 *
 * İki tanım kasıtlı olarak farklı: biri **çok kalemli ve indirimli** (10 lazer + 2 cilt
 * bakımı), diğeri tek kalemli, SÜRESİZ ve şubeye özel. Fazın var olma sebebi olan hata —
 * 12 seansın hepsinin lazer olarak tüketilmesi — ancak çok kalemli bir paketle ekranda
 * sınanabilir; "süresiz" ile "0 gün" farkı ve şube kapsamı da ancak ikinci tanımla.
 *
 * Kalem adı ve birim fiyatı [MockCatalogService.ALL]'dan TÜRETİLİR, burada kopyalanmaz:
 * katalogdaki bir fiyat değişince seed sessizce eskimesin.
 */
internal object MockPackagesSeed {
    const val DEFINITION_LASER_10 = "f1000000-0000-4000-8000-000000000001"
    const val DEFINITION_SKIN_CARE_5 = "f1000000-0000-4000-8000-000000000002"

    /** Sabit bir an — testler çalıştırıldıkları saate bağlanmasın. */
    val SEED_NOW: Instant = Instant.parse("2026-09-08T09:00:00Z")

    private const val LASER_SALE_PRICE = 1_250_000L
    private const val SKIN_CARE_SALE_PRICE = 400_000L
    private const val LASER_SESSIONS = 10
    private const val LASER_BONUS_SESSIONS = 2
    private const val SKIN_CARE_SESSIONS = 5
    private const val ONE_YEAR_DAYS = 365

    fun definitions(): List<PackageDefinition> {
        val laserItems =
            listOf(
                item("f4000000-0000-4000-8000-000000000001", MockIds.SERVICE_LASER, LASER_SESSIONS, 0),
                item("f4000000-0000-4000-8000-000000000002", MockIds.SERVICE_SKIN_CARE, LASER_BONUS_SESSIONS, 1),
            )
        val skinItems =
            listOf(item("f4000000-0000-4000-8000-000000000003", MockIds.SERVICE_SKIN_CARE, SKIN_CARE_SESSIONS, 0))

        return listOf(
            PackageDefinition(
                id = DEFINITION_LASER_10,
                branchId = null,
                slug = "lazer-10-seans",
                name = "10 Seans Lazer + 2 Bakım",
                description = "Bölgesel lazer epilasyon paketi, iki cilt bakımı hediye.",
                // 10 × 1.450 ₺ + 2 × 900 ₺ = 16.300 ₺ liste → 12.500 ₺ satış, %23 indirim.
                totalPriceMinor = LASER_SALE_PRICE,
                listPriceMinor = laserItems.sumOf { it.listTotalMinor },
                validityDays = ONE_YEAR_DAYS,
                isTransferable = true,
                isOnlineSellable = true,
                items = laserItems,
                createdAt = SEED_NOW.minusSeconds(2 * DAY_SECONDS),
                updatedAt = SEED_NOW.minusSeconds(2 * DAY_SECONDS),
            ),
            PackageDefinition(
                id = DEFINITION_SKIN_CARE_5,
                branchId = MockIds.BRANCH_NISANTASI,
                slug = "cilt-bakimi-5",
                name = "5 Seans Cilt Bakımı",
                totalPriceMinor = SKIN_CARE_SALE_PRICE,
                listPriceMinor = skinItems.sumOf { it.listTotalMinor },
                // Süresiz paket — "geçerlilik yok" ile "0 gün" farkı ekranda sınansın.
                validityDays = null,
                isTransferable = false,
                isOnlineSellable = false,
                // Birkaç kez düzenlenmiş bir tanım: `revision` ile `version`'ın ayrı
                // sayaçlar olduğu ancak eşit olmadıklarında görünür.
                revision = 2,
                version = 3,
                items = skinItems,
                createdAt = SEED_NOW.minusSeconds(DAY_SECONDS),
                updatedAt = SEED_NOW.minusSeconds(DAY_SECONDS),
            ),
        )
    }

    private fun item(
        id: String,
        serviceId: String,
        quantity: Int,
        sortOrder: Int,
    ): PackageDefinitionItem {
        val service = MockCatalogService.ALL.first { it.id == serviceId }
        return PackageDefinitionItem(
            id = id,
            serviceId = service.id,
            serviceName = service.name,
            quantity = quantity,
            unitListPriceMinor = service.priceMinor,
            sortOrder = sortOrder,
        )
    }

    // --- A5.2: satılmış paket ve defteri ---

    const val SOLD_AYSE_PACKAGE = "f2000000-0000-4000-8000-000000000001"
    const val SOLD_AYSE_ITEM_LASER = "f3000000-0000-4000-8000-000000000001"
    const val SOLD_AYSE_ITEM_SKIN = "f3000000-0000-4000-8000-000000000002"

    /** Ayşe Yılmaz — `MockCustomers.ALL` ilk satırı. */
    val AYSE_ID: String = com.klinara.android.services.mock.MockCustomers.ALL.first().id

    private const val AYSE_SOLD_DAYS_AGO = 60L

    /**
     * Ayşe'nin yarısı kullanılmış paketi — **kalan hak burada YAZILMIYOR**.
     *
     * Kalemler satış anındaki hâlleriyle (kalan = adet) kurulur; kalan hak, [ledger]'ın
     * mock tarafından uygulanmasıyla oluşur. Seed'de "kalan 6" diye elle yazmak, defterle
     * ayrışabilen ikinci bir gerçek demekti — fazın önlemek için var olduğu hata.
     */
    fun soldPackageAtSale(): CustomerPackage {
        val definition = definitions().first { it.id == DEFINITION_LASER_10 }
        val allocations = allocate(definition.totalPriceMinor, definition.sortedItems.map { it.listTotalMinor })
        val itemIds = listOf(SOLD_AYSE_ITEM_LASER, SOLD_AYSE_ITEM_SKIN)
        val soldAt = SEED_NOW.minusSeconds(AYSE_SOLD_DAYS_AGO * DAY_SECONDS)
        val items =
            definition.sortedItems.mapIndexed { index, item ->
                CustomerPackageItem(
                    id = itemIds[index],
                    serviceId = item.serviceId,
                    serviceName = item.serviceName,
                    quantityTotal = item.quantity,
                    remainingSessions = item.quantity,
                    unitListPriceMinor = item.unitListPriceMinor,
                    itemTotalMinor = allocations[index],
                    outstandingMinor = allocations[index],
                    sortOrder = item.sortOrder,
                )
            }
        return CustomerPackage(
            id = SOLD_AYSE_PACKAGE,
            customerId = AYSE_ID,
            branchId = com.klinara.android.services.mock.MockIds.BRANCH_NISANTASI,
            definitionId = definition.id,
            name = definition.name,
            definitionRevision = definition.revision,
            totalPriceMinor = definition.totalPriceMinor,
            isTransferable = definition.isTransferable,
            validityDays = definition.validityDays,
            soldAt = soldAt,
            expiresAt = definition.validityDays?.let { soldAt.plusSeconds(it * DAY_SECONDS) },
            remainingSessions = items.sumOf { it.quantityTotal },
            outstandingMinor = definition.totalPriceMinor,
            items = items,
            createdAt = soldAt,
        )
    }

    /**
     * Satış + dört kullanım (biri ters kayıtla geri alınmış) + bir bakım kullanımı + bir
     * manuel düzeltme: defter ekranının bütün satır tiplerini tek pakette gösterir.
     * Sonuç: lazer 10 → 6, bakım 2 → 1, toplam 7.
     */
    data class SeedEntry(
        val itemId: String,
        val type: LedgerEntryType,
        val delta: Int,
        val daysAgo: Long,
        val reason: String? = null,
        val reversesIndex: Int? = null,
    )

    val AYSE_LEDGER: List<SeedEntry> =
        listOf(
            SeedEntry(SOLD_AYSE_ITEM_LASER, LedgerEntryType.Purchase, delta = 10, daysAgo = 60),
            SeedEntry(SOLD_AYSE_ITEM_SKIN, LedgerEntryType.Purchase, delta = 2, daysAgo = 60),
            SeedEntry(SOLD_AYSE_ITEM_LASER, LedgerEntryType.Consume, delta = -1, daysAgo = 50),
            SeedEntry(SOLD_AYSE_ITEM_LASER, LedgerEntryType.Consume, delta = -1, daysAgo = 36),
            SeedEntry(SOLD_AYSE_ITEM_LASER, LedgerEntryType.Consume, delta = -1, daysAgo = 22),
            SeedEntry(SOLD_AYSE_ITEM_LASER, LedgerEntryType.Consume, delta = -1, daysAgo = 14),
            SeedEntry(
                SOLD_AYSE_ITEM_LASER,
                LedgerEntryType.Consume,
                delta = 1,
                daysAgo = 14,
                reason = "Randevu tamamlanmadan işaretlenmiş",
                reversesIndex = 5,
            ),
            SeedEntry(SOLD_AYSE_ITEM_SKIN, LedgerEntryType.Consume, delta = -1, daysAgo = 5),
            SeedEntry(
                SOLD_AYSE_ITEM_LASER,
                LedgerEntryType.ManualAdjustment,
                delta = -1,
                daysAgo = 2,
                reason = "Kayıt dışı yapılan seans",
            ),
        )

    /**
     * Largest-remainder dağıtımı — sunucudaki `allocateMinor` ile aynı kural: paylar
     * toplamı DAİMA `total`'e eşittir, kuruş kaybolmaz. Ağırlık toplamı sıfırsa eşit
     * dağıtılır ve artık ilk kaleme gider.
     */
    fun allocate(
        total: Long,
        weights: List<Long>,
    ): List<Long> {
        if (weights.isEmpty()) return emptyList()
        val sum = weights.sum()
        if (sum <= 0L) {
            val equal = MutableList(weights.size) { total / weights.size }
            equal[0] += total - equal.sum()
            return equal
        }
        val shares = weights.map { it * total / sum }.toMutableList()
        var leftover = total - shares.sum()
        weights
            .withIndex()
            .sortedByDescending { (it.value * total) % sum }
            .forEach { (index, _) ->
                if (leftover > 0) {
                    shares[index] += 1
                    leftover -= 1
                }
            }
        return shares
    }

    const val DAY_SECONDS = 86_400L
}
