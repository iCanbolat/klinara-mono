package com.klinara.android.features.calendar

import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.booking.CalendarEntry
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.ClockTime
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * Yerleşim algoritmasının regresyon koruması.
 *
 * Bu kurallar iOS ile birebir aynı olmak ZORUNDA: iki istemci aynı günü farklı sararsa
 * kullanıcı hangisine güveneceğini bilemez ve "randevu kayboldu" diye bildirir.
 */
class CalendarBlockLayoutTest {
    private val clock = BranchClock("Europe/Istanbul")
    private val day = clock.startOfDay(Instant.parse("2026-09-07T12:00:00Z"))

    private fun entry(
        id: String,
        from: ClockTime,
        minutes: Int,
        status: AppointmentStatus = AppointmentStatus.Scheduled,
    ): CalendarEntry {
        val startsAt = clock.date(day, from)
        return CalendarEntry(
            id = id,
            branchId = "b",
            customerId = "c",
            customerName = "Test",
            status = status,
            startsAt = startsAt,
            endsAt = clock.addingMinutes(minutes.toLong(), startsAt),
        )
    }

    private fun place(
        entries: List<CalendarEntry>,
        width: Float = 300f,
    ) = CalendarBlockLayout.place(
        entries = entries,
        clock = clock,
        originMinutes = CalendarBlockLayout.hourRange(entries, clock).first * MINUTES_PER_HOUR,
        width = width,
    )

    @Test
    @DisplayName("Çakışmayan randevular tam genişlik alır")
    fun nonOverlappingUseFullWidth() {
        val placed = place(listOf(entry("a", ClockTime(9, 0), 60), entry("b", ClockTime(13, 0), 60)))

        assertEquals(2, placed.size)
        placed.forEach { assertEquals(0f, it.x, "Tek başına duran blok sola yaslanmalı.") }
        assertTrue(placed.all { it.width > SINGLE_COLUMN_MIN }, "Kümede tek blok varsa genişlik bölünmemeli.")
    }

    @Test
    @DisplayName("Dokunan aralıklar kümeyi BÖLER — çakışma değil, sıradır")
    fun touchingIntervalsSplitTheCluster() {
        // 09:00–10:00 ve 10:00–11:00: bitiş == başlangıç. `>` kullanılsaydı ikisi tek
        // küme olur ve arka arkaya dizilmiş dolu bir gün yarım genişliğe inerdi.
        val placed = place(listOf(entry("a", ClockTime(9, 0), 60), entry("b", ClockTime(10, 0), 60)))

        assertTrue(
            placed.all { it.width > SINGLE_COLUMN_MIN },
            "Uç uca gelen iki randevu çakışmaz; ikisi de tam genişlik almalı.",
        )
    }

    @Test
    @DisplayName("Tam örtüşen üç randevu eşit üç sütuna bölünür")
    fun threeWayOverlapSplitsEvenly() {
        val placed =
            place(
                listOf(
                    entry("a", ClockTime(9, 0), 60),
                    entry("b", ClockTime(9, 0), 60),
                    entry("c", ClockTime(9, 0), 60),
                ),
            )

        assertEquals(3, placed.size)
        val widths = placed.map { it.width }.distinct()
        assertEquals(1, widths.size, "Küme içindeki sütunlar eşit genişlikte olmalı.")
        assertEquals(listOf(0f, 100f, 200f), placed.sortedBy { it.x }.map { it.x })
    }

    @Test
    @DisplayName("Zincirdeki çakışmayan uçlar da 1/N genişlik alır — bu KASITLI")
    fun chainedClusterUsesEqualColumnsEvenForNonOverlappingEnds() {
        // A(09:00–10:00), B(09:30–10:30), C(10:15–11:00): A ile C çakışmıyor ama koşan
        // max(end) süpürmesi üçünü tek kümede tutuyor. "En az sütun" paketlemesi A ve
        // C'ye yarım genişlik verirdi — iOS öyle yapmıyor, biz de yapmıyoruz.
        val placed =
            place(
                listOf(
                    entry("a", ClockTime(9, 0), 60),
                    entry("b", ClockTime(9, 30), 60),
                    entry("c", ClockTime(10, 15), 45),
                ),
            )

        assertEquals(3, placed.size)
        assertEquals(1, placed.map { it.width }.distinct().size, "Üçü de 1/3 genişlik almalı.")
    }

    @Test
    @DisplayName("İptal edilen randevu sütun rezerve ETMEZ")
    fun terminalEntriesDoNotReserveColumns() {
        val placed =
            place(
                listOf(
                    entry("aktif", ClockTime(9, 0), 60),
                    entry("iptal", ClockTime(9, 0), 60, AppointmentStatus.Cancelled),
                ),
            )

        val active = placed.single { it.entry.id == "aktif" }
        val cancelled = placed.single { it.entry.id == "iptal" }

        assertTrue(
            active.width > SINGLE_COLUMN_MIN,
            "İptal edilmiş bir randevunun yanındaki aktif randevuyu yarıya sıkıştırması, " +
                "olmayan bir yoğunluğu göstermek olurdu.",
        )
        assertEquals(0f, cancelled.x)
        assertTrue(cancelled.width > SINGLE_COLUMN_MIN, "Kapanmış blok tam genişlikte çizilir.")
    }

    @Test
    @DisplayName("Gelmedi de terminaldir, bilinmeyen durum DEĞİLDİR")
    fun unknownStatusIsNotTreatedAsClosed() {
        assertTrue(AppointmentStatus.NoShow.isTerminal)
        assertTrue(AppointmentStatus.Cancelled.isTerminal)
        assertTrue(
            !AppointmentStatus.Unknown.isTerminal,
            "Tanımadığımız bir durumu kapanmış saymak, yeni bir 'beklemede' durumunu " +
                "sessizce iptal gibi göstermek olurdu.",
        )
    }

    @Test
    @DisplayName("Çıktı BAŞLANGIÇ sırasında döner — terminal blok altta kalıp kaybolmaz")
    fun outputKeepsStartOrderSoTerminalBlocksStayVisible() {
        // Emülatörde yakalandı: terminal bloklar listenin başına alınınca, tam örtüşen
        // bir aktif blok onları TAMAMEN örtüyordu (15:00–16:00 aktif, 15:30 iptal).
        // Çağıran blokları sırayla üst üste çiziyor; sıra çizim sırasıdır.
        val placed =
            place(
                listOf(
                    entry("aktif", ClockTime(15, 0), 60),
                    entry("iptal", ClockTime(15, 30), 30, AppointmentStatus.Cancelled),
                ),
            )

        assertEquals(
            listOf("aktif", "iptal"),
            placed.map { it.entry.id },
            "Sonra başlayan blok sonra çizilmeli; aksi hâlde iptal hiç görünmez.",
        )
    }

    @Test
    @DisplayName("Kısa randevu taban yüksekliğin altına inmez")
    fun shortEntriesGetMinimumHeight() {
        val placed = place(listOf(entry("a", ClockTime(9, 0), 5)))

        assertEquals(CalendarBlockLayout.MIN_BLOCK_HEIGHT, placed.single().height)
    }

    @Test
    @DisplayName("Saat aralığı 09–19 tabanının altına DARALMAZ")
    fun hourRangeNeverShrinksBelowTheBaseline() {
        val range = CalendarBlockLayout.hourRange(listOf(entry("a", ClockTime(11, 0), 60)), clock)

        assertEquals(9, range.first)
        assertEquals(18, range.last, "9..<19 on saat çizer; son saat kapsayıcı değildir.")
    }

    @Test
    @DisplayName("Taban dışına taşan randevu aralığı GENİŞLETİR")
    fun hourRangeGrowsForOutliers() {
        val range =
            CalendarBlockLayout.hourRange(
                listOf(entry("erken", ClockTime(7, 30), 30), entry("geç", ClockTime(20, 15), 45)),
                clock,
            )

        assertEquals(7, range.first)
        // 21:00'de biten randevu 21. saati de ister (yukarı yuvarlama).
        assertEquals(20, range.last)
    }

    @Test
    @DisplayName("Boş gün de bir ızgara çizer — tabanı")
    fun emptyDayStillHasTheBaselineRange() {
        val range = CalendarBlockLayout.hourRange(emptyList(), clock)

        assertEquals(9, range.first)
        assertEquals(18, range.last)
    }

    private companion object {
        const val MINUTES_PER_HOUR = 60

        /** 300 dp genişlikte tek sütun ~298; iki sütuna bölünseydi ~148 olurdu. */
        const val SINGLE_COLUMN_MIN = 200f
    }
}
