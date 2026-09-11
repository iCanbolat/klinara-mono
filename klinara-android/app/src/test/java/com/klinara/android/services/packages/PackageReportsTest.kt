package com.klinara.android.services.packages

import com.klinara.android.features.packages.amountLabel
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.KlinaraJson
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

/** Paket raporları — çözümleme, sayfalama, yarı açık aralık ve parasal alan gizleme. */
class PackageReportsTest {
    private val september =
        ReportPeriod(Instant.parse("2026-08-31T21:00:00Z"), Instant.parse("2026-09-30T21:00:00Z"))

    private fun <T> decode(
        path: String,
        deserializer: kotlinx.serialization.DeserializationStrategy<T>,
    ): T = KlinaraJson.decodeFromString(deserializer, Fixtures.read(path))

    @Test
    @DisplayName("Yükümlülük raporu çözülüyor; silinmiş kırılımın groupId'si null olabiliyor")
    fun outstandingDecodes() {
        val report = decode("packages/outstanding-report.json", OutstandingReport.serializer())

        assertEquals(1_548_000L, report.totals.outstandingMinor)
        assertNull(report.data[1].groupId)
        assertEquals("Silinmiş hizmet", report.data[1].key)
    }

    @Test
    @DisplayName("İzinsiz süre dolumu raporunda tutar NULL ve ekran '—' yazıyor, '0 ₺' DEĞİL")
    fun expiringWithoutRevenueShowsDash() {
        val report = decode("packages/expiring-report-no-revenue.json", ExpiringReport.serializer())

        // Biri açık `null`, diğerinde alan hiç yok — ikisi de "göremiyorsun".
        assertTrue(report.data.all { it.outstandingMinor == null })
        assertEquals("—", amountLabel(report.data.first()))
        assertTrue(report.pageInfo.hasMore)
    }

    @Test
    @DisplayName("Kullanım raporu çözülüyor")
    fun usageDecodes() {
        val row = decode("packages/usage-report.json", UsageReport.serializer()).data.single()

        assertEquals(3, row.consumed)
        assertEquals(1, row.transferred)
    }

    @Test
    @DisplayName("Mock: yükümlülük toplamı açık paketlerin karşılıklarının toplamı; izinsiz rolde 403")
    fun outstandingTotalsAndPermission() =
        runTest {
            val service = MockPackagesService(latencyEnabled = false)
            val packages = MockPackagesSeed.SOLD_PACKAGES.map { it.id }
            val expected = packages.sumOf { service.customerPackage(it).outstandingMinor }

            val report = service.outstandingReport(groupBy = OutstandingGrouping.Branch)

            assertEquals(expected, report.totals.outstandingMinor)
            assertEquals(setOf("Nişantaşı", "Bodrum"), report.data.map { it.groupLabel }.toSet())

            val denied = MockPackagesService(latencyEnabled = false, canReadRevenue = { false })
            val code = runCatching { denied.outstandingReport() }.exceptionOrNull() as? ApiError
            assertEquals(ApiErrorCode.FORBIDDEN, code?.code)
        }

    @Test
    @DisplayName("Mock: süre dolumu aralığı YARI AÇIK — tam `to` anında dolan paket dahil DEĞİL")
    fun expiringIsHalfOpen() =
        runTest {
            val service = MockPackagesService(latencyEnabled = false)
            val selin = service.customerPackage(MockPackagesSeed.SOLD_SELIN_PACKAGE).expiresAt!!

            val endingAt = service.expiringReport(ReportPeriod(selin.minusSeconds(3600), selin)).data
            val startingAt = service.expiringReport(ReportPeriod(selin, selin.plusSeconds(3600))).data

            assertTrue(endingAt.none { it.customerPackageId == MockPackagesSeed.SOLD_SELIN_PACKAGE })
            assertTrue(startingAt.any { it.customerPackageId == MockPackagesSeed.SOLD_SELIN_PACKAGE })
        }

    @Test
    @DisplayName("Mock: sayfaları izlemek sayfasız yanıtın AYNISINI veriyor; son sayfada imleç yok")
    fun expiringPaginationIsLossless() =
        runTest {
            val service = MockPackagesService(latencyEnabled = false)
            val all = service.expiringReport(september, limit = 200).data

            val walked = mutableListOf<ExpiringRow>()
            var cursor: String? = null
            do {
                val page = service.expiringReport(september, cursor = cursor, limit = 1)
                walked += page.data
                cursor = page.pageInfo.nextCursor
            } while (cursor != null)

            assertEquals(2, all.size)
            assertEquals(all, walked)
            val order = listOf(MockPackagesSeed.SOLD_SELIN_PACKAGE, MockPackagesSeed.SOLD_FATMA_PACKAGE)
            assertEquals(order, all.map { it.customerPackageId }, "Keyset sırası: önce dolan önce")
        }

    @Test
    @DisplayName("Mock: izinsiz rolde süre dolumu satırlarında tutar null")
    fun expiringHidesAmountWithoutRevenue() =
        runTest {
            val service = MockPackagesService(latencyEnabled = false, canReadRevenue = { false })

            assertTrue(service.expiringReport(september).data.all { it.outstandingMinor == null })
        }

    @Test
    @DisplayName("Mock: kullanımda ters kayıt TÜKETİMDEN düşüyor ve şube filtresi uygulanıyor")
    fun usageSubtractsReversals() =
        runTest {
            val service = MockPackagesService(latencyEnabled = false)
            // Ayşe'nin defteri seed anından 60 gün geriye uzanıyor; tüm geçmişi kapsayan dönem.
            val everything = ReportPeriod(Instant.parse("2025-01-01T00:00:00Z"), Instant.parse("2027-01-01T00:00:00Z"))

            val nisantasi = service.usageReport(everything, branchId = MockIds.BRANCH_NISANTASI).data
            val laser = nisantasi.first { it.groupId == MockIds.SERVICE_LASER }

            // Ayşe: 4 kullanım − 1 ters kayıt = 3; Fatma: 7 → toplam 10.
            assertEquals(10, laser.consumed)
            assertEquals(20, laser.purchased)
            assertEquals(1, laser.adjusted)
        }
}
