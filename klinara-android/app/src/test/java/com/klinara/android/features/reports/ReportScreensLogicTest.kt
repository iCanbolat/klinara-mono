package com.klinara.android.features.reports

import com.klinara.android.designsystem.components.niceAxis
import com.klinara.android.features.shell.ShellSessions
import com.klinara.android.features.shell.managementSections
import com.klinara.android.services.reports.ReportKind
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/** A9.2'nin saf kısımları — izin matrisi, hub kartı, biçimlendirme, grafik ekseni. */
class ReportScreensLogicTest {
    private fun visible(role: String) = ReportAccess.visible(ShellSessions.forRole(role)::can)

    @Test
    @DisplayName("Rapor girişi rol matrisi sunucunun izin kapılarıyla aynı")
    fun accessMatrix() {
        val all = ReportKind.entries
        assertEquals(all, visible("owner"))
        assertEquals(all, visible("manager"))
        assertEquals(listOf(ReportKind.Revenue, ReportKind.StaffPerformance), visible("accountant"))
        assertEquals(listOf(ReportKind.Occupancy, ReportKind.NoShow, ReportKind.Retention), visible("receptionist"))
        assertEquals(listOf(ReportKind.Occupancy, ReportKind.StaffPerformance), visible("practitioner"))
    }

    @Test
    @DisplayName("Raporlar kartı: klinik + paket raporları tek kartta; paket raporları Paketler kartından çıktı")
    fun reportsCard() {
        fun rows(role: String) =
            managementSections(ShellSessions.forRole(role))
                .firstOrNull { it.title == "Raporlar" }
                ?.rows
                ?.map { it.label }

        assertEquals(listOf("Klinik raporları", "Paket raporları"), rows("manager"))
        assertEquals(listOf("Klinik raporları", "Paket raporları"), rows("accountant"))
        assertEquals(listOf("Klinik raporları", "Paket raporları"), rows("practitioner"))
        val packages = managementSections(ShellSessions.forRole("manager")).first { it.title == "Paketler" }
        assertEquals(listOf("Paket tanımları"), packages.rows.map { it.label })
    }

    @Test
    @DisplayName("Yüzde ve değişim: `null` 'kıyaslanamaz', 0 değişim yok; anahtar yoksa satır yok")
    fun formatting() {
        assertEquals("%33,33", ReportFormat.percent(33.33))
        assertEquals("%0", ReportFormat.percent(0.0))
        assertEquals("1.234,5", ReportFormat.number(1234.5))
        assertEquals("+%12,5", ReportFormat.delta(12.5))
        assertEquals("−%8,4", ReportFormat.delta(-8.4))
        assertEquals("%0", ReportFormat.delta(0.0))
        assertNull(ReportFormat.delta(null))

        val delta = mapOf("a" to 12.5, "b" to null)
        assertEquals("Önceki döneme göre +%12,5", ReportFormat.deltaLabel(delta, "a"))
        assertEquals("Önceki dönemde sıfırdı — kıyaslanamaz", ReportFormat.deltaLabel(delta, "b"))
        assertNull(ReportFormat.deltaLabel(delta, "c"), "rapor o alanı kıyaslamıyor")
        assertNull(ReportFormat.deltaLabel(null, "a"), "karşılaştırma kapalı")
    }

    @Test
    @DisplayName("Grafik ekseni yuvarlak adımlarla; sayımda kesirli etiket yok; hepsi sıfırsa 0–1")
    fun axis() {
        assertEquals(listOf(0.0, 40.0, 80.0), niceAxis(62.5).ticks)
        assertEquals(listOf(0.0, 6.0, 12.0), niceAxis(12.0).ticks)
        assertEquals(100.0, niceAxis(100.0).top)
        assertEquals(1_600_000.0, niceAxis(1_234_567.0).top)
        assertEquals(0.5, niceAxis(0.5).top, 1e-9)
        assertEquals(1.0, niceAxis(0.0).top)
        // Sayım: bir müşterilik grafikte "0,5" etiketi yazılmaz.
        assertEquals(listOf(0.0, 1.0), niceAxis(1.0, integerValues = true).ticks)
        assertEquals(listOf(0.0, 4.0, 8.0), niceAxis(7.0, integerValues = true).ticks)
    }
}
