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

    const val DAY_SECONDS = 86_400L
}
