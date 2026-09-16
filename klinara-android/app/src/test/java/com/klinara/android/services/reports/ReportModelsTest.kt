package com.klinara.android.services.reports

import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.KlinaraJson
import kotlinx.serialization.DeserializationStrategy
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * Rapor yanıtları — `klinara-fixtures/reports/` yerel API'den (seed, `sahip@demo-klinik.test`)
 * yakalandı ve ÜRETİM çözümleyicisiyle (`KlinaraJson`) çözülüyor.
 */
class ReportModelsTest {
    private fun <T> decode(
        name: String,
        deserializer: DeserializationStrategy<T>,
    ): T = KlinaraJson.decodeFromString(deserializer, Fixtures.read("reports/$name.json"))

    @Test
    @DisplayName("Doluluk: `null` delta KIYASLANAMAZ, `0` değişim yok — ikisi ayrı taşınıyor")
    fun occupancyDeltaKeepsNullApartFromZero() {
        val report = decode("occupancy", OccupancyReport.serializer())

        assertEquals(ReportScope.All, report.scope)
        assertEquals(1.85, report.totals.occupancyRate)
        val delta = requireNotNull(report.delta)
        assertTrue(delta.containsKey("occupancyRate"))
        assertNull(delta["occupancyRate"])
        assertEquals(0.0, delta["availableMinutes"])
        // Fixture `pageInfo` taşımıyor; alan opsiyonel olmalı.
        assertNull(report.pageInfo)
    }

    @Test
    @DisplayName("Doluluk gün kırılımı: groupId null, satır kimliği etiket (YYYY-MM-DD)")
    fun occupancyByDayUsesLabelAsIdentity() {
        val report = decode("occupancy-by-day", OccupancyReport.serializer())

        assertTrue(report.data.all { it.groupId == null })
        assertEquals("2026-09-07", report.data.first().id)
        assertEquals(report.data.size, report.data.map { it.id }.toSet().size)
        assertNull(report.previous)
    }

    @Test
    @DisplayName("Ciro: atıfsız satır `—`")
    fun revenueDecodes() {
        val report = decode("revenue", RevenueReport.serializer())

        assertEquals("—", report.data.first().groupLabel)
        assertEquals(report.data.first().groupLabel, report.data.first().id)
        assertEquals(350_000L, report.totals.accruedMinor)
        assertTrue(report.hasMovement)
    }

    @Test
    @DisplayName("Satırsız ama cirolu dönem 'hareket yok' SAYILMAZ (sayfalı satırlar)")
    fun revenueWithoutRowsCanStillHaveMovement() {
        val report = decode("revenue", RevenueReport.serializer()).copy(data = emptyList())

        assertTrue(report.hasMovement)
        assertFalse(report.copy(totals = RevenueTotals()).hasMovement)
    }

    @Test
    @DisplayName("Personel performansı: `scope: own` sunucudan geliyor, istemci türetmiyor")
    fun staffPerformanceScope() {
        assertEquals(ReportScope.All, decode("staff-performance", StaffPerformanceReport.serializer()).scope)
        val own = decode("staff-performance-own", StaffPerformanceReport.serializer())
        assertEquals(ReportScope.Own, own.scope)
        assertEquals(1, own.data.size)
    }

    @Test
    @DisplayName("Gelmeme: kaynak kırılımı ve karşılaştırma çözülüyor; `scope` alanı yok")
    fun noShowDecodes() {
        val report = decode("no-show", NoShowReport.serializer())

        assertEquals(33.33, report.totals.noShowRate)
        assertEquals("Klinikten", report.byOrigin.single().turkishName)
        assertNull(report.delta!!["noShowRate"])
        assertEquals(0.0, report.delta["cancellationRate"])
    }

    @Test
    @DisplayName("Kazanım: kaynağı girilmemiş müşteri 'Belirtilmemiş'; bilinen kaynak kartın Türkçe adı")
    fun retentionDecodes() {
        val report = decode("retention", RetentionReport.serializer())

        assertEquals("Belirtilmemiş", report.acquisition.single().turkishName)
        assertEquals(AcquisitionRow.UNKNOWN_ID, report.acquisition.single().id)
        assertEquals(listOf(30, 60, 90), report.cohorts.map { it.withinDays })
        assertEquals("Instagram", AcquisitionRow("instagram", 1).turkishName)
        assertEquals("tiktok", AcquisitionRow("tiktok", 1).turkishName)
    }

    @Test
    @DisplayName("Bilinmeyen kapsam değeri çökertmiyor")
    fun unknownScopeIsTolerated() {
        val raw = Fixtures.read("reports/staff-performance.json").replace("\"all\"", "\"team\"")
        val report = KlinaraJson.decodeFromString(StaffPerformanceReport.serializer(), raw)

        assertEquals(ReportScope.Unknown, report.scope)
    }
}
