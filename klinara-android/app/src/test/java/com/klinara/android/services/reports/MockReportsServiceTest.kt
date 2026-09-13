package com.klinara.android.services.reports

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.contracts.RolePermissions
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

/** Rapor mock'u — izin kapıları, kapsam, sayfalama, karşılaştırma ve CSV. */
class MockReportsServiceTest {
    /** Eylül 2026, İstanbul: `[1 Eyl 00:00, 1 Eki 00:00)`. */
    private val september =
        ReportPeriod(Instant.parse("2026-08-31T21:00:00Z"), Instant.parse("2026-09-30T21:00:00Z"))
    private val august =
        ReportPeriod(Instant.parse("2026-07-31T21:00:00Z"), Instant.parse("2026-08-31T21:00:00Z"))
    private val now = Instant.parse("2026-09-12T09:00:00Z")

    private fun service(role: String = "manager") =
        MockReportsService(latencyEnabled = false, permissions = { RolePermissions.forRole(role) }, now = { now })

    private suspend fun code(block: suspend () -> Unit): ApiErrorCode? =
        (runCatching { block() }.exceptionOrNull() as? ApiError)?.code

    @Test
    @DisplayName("İzin kapıları sunucununkiyle aynı — rol başına açık/kapalı rapor matrisi")
    fun permissionMatrix() =
        runTest {
            val query = ReportQuery(august, branchId = null)
            suspend fun matrix(role: String): List<Boolean> {
                val service = service(role)
                val calls: List<suspend () -> Any> =
                    listOf(
                        { service.occupancy(query, OccupancyGrouping.Staff) },
                        { service.revenue(query, RevenueGrouping.Service) },
                        { service.staffPerformance(query) },
                        { service.noShow(query, NoShowGrouping.Staff) },
                        { service.retention(query) },
                    )
                return calls.map { call -> code { call() } != ApiErrorCode.FORBIDDEN }
            }

            //                                   doluluk ciro  perf  gelmeme kazanım
            assertEquals(listOf(true, true, true, true, true), matrix("owner"))
            assertEquals(listOf(true, true, true, true, true), matrix("manager"))
            assertEquals(listOf(false, true, true, false, false), matrix("accountant"))
            assertEquals(listOf(true, false, false, true, true), matrix("receptionist"))
            assertEquals(listOf(true, false, true, false, false), matrix("practitioner"))
        }

    @Test
    @DisplayName("Uygulayıcı kendi satırına kilitlenir ve yanıt `scope: own` der")
    fun practitionerIsScopedToOwnRow() =
        runTest {
            val query = ReportQuery(august, branchId = null)
            val staff = service("practitioner").staffPerformance(query)
            val occupancy = service("practitioner").occupancy(query, OccupancyGrouping.Staff)

            assertEquals(ReportScope.Own, staff.scope)
            assertEquals(listOf(MockIds.STAFF_DERYA), staff.data.map { it.staffProfileId })
            assertEquals(ReportScope.Own, occupancy.scope)
            assertEquals(listOf(MockIds.STAFF_DERYA), occupancy.data.map { it.groupId })

            // Yönetici üç personeli de görür; kapsam `all`.
            val all = service().staffPerformance(query)
            assertEquals(ReportScope.All, all.scope)
            assertEquals(3, all.data.size)
        }

    @Test
    @DisplayName("Sayfalama kayıpsız: gün kırılımı limit=7 ile yürününce sayfasız yanıtın aynısı; toplamlar sabit")
    fun paginationIsLossless() =
        runTest {
            val service = service()
            val query = ReportQuery(september, branchId = null, compareToPrevious = true)
            val unpaged = service.occupancy(query, OccupancyGrouping.Day)
            assertFalse(unpaged.pageInfo!!.hasMore)

            val walked = mutableListOf<OccupancyRow>()
            var cursor: String? = null
            do {
                val page = service.occupancy(query, OccupancyGrouping.Day, ReportPage(limit = 7, cursor = cursor))
                assertEquals(unpaged.totals, page.totals, "toplamlar sayfadan ETKİLENMEZ")
                assertEquals(unpaged.delta, page.delta)
                walked += page.data
                cursor = page.pageInfo!!.nextCursor
            } while (cursor != null)

            assertEquals(unpaged.data, walked)
        }

    @Test
    @DisplayName("Yarı açık aralık: Eylül 26 iş günü (pazar kapalı), 1 Ekim DAHİL DEĞİL")
    fun periodIsHalfOpen() =
        runTest {
            val rows = service().occupancy(ReportQuery(september, null), OccupancyGrouping.Day).data

            assertEquals("2026-09-01", rows.first().groupLabel)
            assertEquals("2026-09-30", rows.last().groupLabel)
            assertEquals(26, rows.size)
        }

    @Test
    @DisplayName("Toplam oran satır oranlarının ortalaması DEĞİL, toplam pay / toplam payda")
    fun totalRateIsPooled() =
        runTest {
            val report = service().occupancy(ReportQuery(august, null), OccupancyGrouping.Staff)
            val booked = report.data.sumOf { it.bookedMinutes }
            val available = report.data.sumOf { it.availableMinutes }

            assertEquals(booked, report.totals.bookedMinutes)
            assertEquals(Math.round(booked * 10_000.0 / available) / 100.0, report.totals.occupancyRate)
        }

    @Test
    @DisplayName("Karşılaştırma: açılışı içeren dönemde önceki dönem 0 → delta NULL; ikisi de 0 → 0")
    fun deltaIsNullWhenPreviousIsZero() =
        runTest {
            // 5 Ocak 2026 açılış; aralık onu içeriyor, önceki aynı uzunluktaki pencere boş.
            val opening = ReportPeriod(Instant.parse("2026-01-04T21:00:00Z"), Instant.parse("2026-01-11T21:00:00Z"))
            val report = service().noShow(ReportQuery(opening, null, compareToPrevious = true), NoShowGrouping.Staff)

            assertEquals(0, report.previous!!.total)
            assertTrue(report.delta!!.containsKey("total"))
            assertNull(report.delta["total"])

            val beforeOpening =
                ReportPeriod(Instant.parse("2025-12-01T21:00:00Z"), Instant.parse("2025-12-08T21:00:00Z"))
            val empty =
                service().noShow(ReportQuery(beforeOpening, null, compareToPrevious = true), NoShowGrouping.Staff)
            assertEquals(0.0, empty.delta!!["total"])

            // İstenmezse hiç yok.
            assertNull(service().noShow(ReportQuery(opening, null), NoShowGrouping.Staff).delta)
        }

    @Test
    @DisplayName("Ciro: yöntem kırılımında tahakkuk 0; tahsilat kırılımı toplamı tutuyor")
    fun revenueByMethod() =
        runTest {
            val report = service().revenue(ReportQuery(august, null), RevenueGrouping.Method)

            assertTrue(report.data.isNotEmpty())
            assertTrue(report.data.all { it.accruedMinor == 0L })
            assertEquals(report.totals.collectedMinor, report.data.sumOf { it.collectedMinor })
            assertTrue(report.totals.accruedMinor > report.totals.collectedMinor, "ödenmemiş kalem var")
        }

    @Test
    @DisplayName("Gelmeme: grain randevu — satırlar ve kaynak kırılımı toplamı tutuyor")
    fun noShowAddsUp() =
        runTest {
            val report = service().noShow(ReportQuery(august, null), NoShowGrouping.Service)

            assertEquals(report.totals.total, report.data.sumOf { it.total })
            assertEquals(report.totals.total, report.byOrigin.sumOf { it.total })
            assertTrue(report.totals.noShow > 0)
            assertEquals(listOf("internal", "online"), report.byOrigin.map { it.origin })
        }

    @Test
    @DisplayName("Kazanım: yeni + geri gelen = aktif; kaynak kırılımı yeni müşterileri sayar; kaynaksız en sonda")
    fun retentionAddsUp() =
        runTest {
            val report = service().retention(ReportQuery(august, null))

            with(report.totals) { assertEquals(activeCustomers, newCustomers + returningCustomers) }
            assertTrue(report.totals.newCustomers > 0)
            assertEquals(report.totals.newCustomers, report.acquisition.sumOf { it.customers })
            assertEquals(listOf(30, 60, 90), report.cohorts.map { it.withinDays })
            // Uzun pencere daha çok geri dönüşü kapsar.
            assertTrue(report.cohorts.zipWithNext().all { (a, b) -> a.returned <= b.returned })
        }

    @Test
    @DisplayName("Personelsiz şube boş rapor döndürüyor — hata değil")
    fun emptyBranchIsEmpty() =
        runTest {
            val report = service().occupancy(ReportQuery(august, MockIds.BRANCH_BODRUM), OccupancyGrouping.Staff)

            assertTrue(report.data.isEmpty())
            assertEquals(0, report.totals.availableMinutes)
        }

    @Test
    @DisplayName("CSV: BOM, `;` ayraç, sunucunun başlıkları, virgüllü para; sayfasız")
    fun exportCsv() =
        runTest {
            val bytes = service().export(ReportKind.Revenue, ReportQuery(august, null), RevenueGrouping.Service.wire)
            val text = bytes.toString(Charsets.UTF_8)
            val lines = text.removePrefix("\uFEFF").split("\r\n").filter { it.isNotEmpty() }

            assertTrue(text.startsWith("\uFEFF"))
            assertEquals("Kırılım;Tahakkuk;Tahakkuk (kuruş);Tahsilat;Tahsilat (kuruş);Para birimi", lines.first())
            val report = service().revenue(ReportQuery(august, null), RevenueGrouping.Service)
            assertEquals(report.data.size, lines.size - 1)
            val first = report.data.first()
            assertEquals(
                "${first.groupLabel};${first.accruedMinor / 100},${"%02d".format(first.accruedMinor % 100)};" +
                    "${first.accruedMinor}",
                lines[1].split(";").take(3).joinToString(";"),
            )
        }

    @Test
    @DisplayName("CSV izin kapısını raporla paylaşıyor; geçersiz gruplama doğrulama hatası")
    fun exportGates() =
        runTest {
            val query = ReportQuery(august, null)
            assertEquals(ApiErrorCode.FORBIDDEN, code { service("receptionist").export(ReportKind.Revenue, query) })
            assertEquals(ApiErrorCode.VALIDATION_FAILED, code { service().export(ReportKind.NoShow, query, "planet") })
            assertNotNull(service("practitioner").export(ReportKind.StaffPerformance, query))
        }

    @Test
    @DisplayName("Ağ hatası senaryosu raporları da düşürüyor")
    fun failingIsNetwork() =
        runTest {
            val service = service().apply { failing = true }
            val error = runCatching { service.retention(ReportQuery(august, null)) }.exceptionOrNull()

            assertTrue(error is ApiError.Network)
        }
}
