package com.klinara.android.features.calendar

import com.klinara.android.services.booking.CalendarEntry
import com.klinara.android.services.formatting.BranchClock
import java.time.Instant
import kotlin.math.max
import kotlin.math.min

/**
 * Yerleştirilmiş bir randevu bloğu. Ölçüler **dp değeri** taşıyan `Float`'lardır;
 * `Dp` tipi bilerek kullanılmadı ki bu dosya Compose'suz kalsın ve tamamen JVM
 * testinde sürülebilsin.
 */
data class PlacedBlock(
    val entry: CalendarEntry,
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
)

/**
 * Çakışan randevuların yerleşimi. Gün ve hafta ızgarası **aynı** fonksiyonu çağırır;
 * aksi hâlde iki görünüm aynı günü farklı sararak birbirini yalanlardı.
 *
 * Kurallar iOS `CalendarBlockLayout.swift` ile birebir. Bu bir *parite* meselesi
 * değil sadece: iki istemci aynı günü farklı çizerse, kullanıcı hangisine güveneceğini
 * bilemez ve "randevu kayboldu" diye bildirir.
 *
 * **Bu bir "en az sütun" paketlemesi DEĞİL.** A(09–10), B(09:30–10:30), C(10:15–11)
 * tek bir kümedir ve üçü de 1/3 genişlik alır — A ile C çakışmadığı hâlde. Sebep:
 * küme, koşan `max(end)` süpürmesiyle kuruluyor. Daha akıllı bir paketleme yazmak
 * teknik olarak mümkün ama iki istemciyi ayrıştırır.
 */
object CalendarBlockLayout {
    /** Saat başına yükseklik. Tüm dikey geometrinin tek kaynağı. */
    const val HOUR_HEIGHT = 64f

    /** Bir blok bundan kısa çizilmez; 15 dakikalık randevu da okunabilir kalmalı. */
    const val MIN_BLOCK_HEIGHT = 28f

    /** Süre tabanı: sıfır dakikalık bir kayıt bile bir yer kaplar. */
    const val MIN_MINUTES = 15

    /** Sütunlar arası boşluk. */
    private const val COLUMN_GAP = 2f

    private const val MINUTES_PER_HOUR = 60
    private const val DEFAULT_FIRST_HOUR = 9
    private const val DEFAULT_LAST_HOUR = 19

    fun offsetFor(minutesFromRangeStart: Int): Float = minutesFromRangeStart / MINUTES_PER_HOUR.toFloat() * HOUR_HEIGHT

    fun heightFor(minutes: Int): Float = max(MIN_BLOCK_HEIGHT, minutes / MINUTES_PER_HOUR.toFloat() * HOUR_HEIGHT)

    /**
     * Izgaranın saat aralığı — **şube çalışma saatlerinden GELMEZ**.
     *
     * 09–19 bir taban, bir kapak değil: aralık yalnız genişler. Şube saatlerine
     * bağlamak `GET branches/:id/hours` çağrısı (ve `schedule:read` izni) eklerdi ve
     * iOS'tan ayrışırdı; şube saatlerinin ızgarayı belirlemesi iki istemcide birlikte
     * alınacak ayrı bir üründür.
     */
    fun hourRange(
        entries: List<CalendarEntry>,
        clock: BranchClock,
    ): IntRange {
        val starts = entries.map { clock.minutesFromMidnight(it.startsAt) / MINUTES_PER_HOUR }
        val ends =
            entries.map { entry ->
                val minutes = clock.minutesFromMidnight(entry.endsAt)
                // Yukarı yuvarla: 18:15'te biten randevu 19. saati de ister.
                (minutes + MINUTES_PER_HOUR - 1) / MINUTES_PER_HOUR
            }
        val lower = min(starts.minOrNull() ?: DEFAULT_FIRST_HOUR, DEFAULT_FIRST_HOUR)
        val upper = max(ends.maxOrNull() ?: DEFAULT_LAST_HOUR, DEFAULT_LAST_HOUR)
        // Son saat kapsayıcı DEĞİL: 9..<19 on saat çizer.
        return lower until max(upper, lower + 1)
    }

    /**
     * Blokları yerleştirir.
     *
     * @param originMinutes ızgaranın başladığı dakika (gece yarısından), yani
     *   `hourRange().first * 60`.
     * @param width kullanılabilir genişlik (dp değeri).
     * @param gutter sağda bırakılan boşluk. Gün ızgarası nefes payı ister, hafta
     *   sütunları zaten dar — orada `0`.
     */
    fun place(
        entries: List<CalendarEntry>,
        clock: BranchClock,
        originMinutes: Int,
        width: Float,
        gutter: Float = 0f,
    ): List<PlacedBlock> {
        val usable = max(width - gutter, 1f)
        val ordered = entries.sortedBy { it.startsAt }

        // Kapanmış randevu sütun REZERVE ETMEZ: iptal edilmiş bir randevunun yanındaki
        // randevuyu yarım genişliğe sıkıştırması, olmayan bir yoğunluğu göstermek
        // olurdu. Tam genişlikte, soluk çizilir ve kümelemeye HİÇ girmez.
        val (terminal, active) = ordered.partition { it.status.isTerminal }

        val byId = mutableMapOf<String, PlacedBlock>()

        terminal.forEach { entry ->
            val (y, height) = geometry(entry, clock, originMinutes)
            byId[entry.id] = PlacedBlock(entry, x = 0f, y = y, width = usable, height = height)
        }

        for (cluster in clusters(active)) {
            val columnWidth = usable / cluster.size
            cluster.forEachIndexed { index, entry ->
                val (y, height) = geometry(entry, clock, originMinutes)
                byId[entry.id] =
                    PlacedBlock(
                        entry = entry,
                        x = index * columnWidth,
                        y = y,
                        width = max(columnWidth - COLUMN_GAP, 1f),
                        height = height,
                    )
            }
        }

        // Çıktı BAŞLANGIÇ SIRASINDA döner, kümeleme sırasında değil.
        // Çağıran bunları üst üste çiziyor; terminal blokları listenin başına almak,
        // tam örtüşen bir aktif bloğun altında kalıp HİÇ görünmemeleri demekti
        // (emülatörde yakalandı: 15:00–16:00 aktif blok, 15:30 iptali tamamen örttü).
        // Sırayı korumak "sonra başlayan üstte" kuralını verir: öngörülebilir ve
        // iOS'un çizim sırasıyla aynı.
        return ordered.mapNotNull { byId[it.id] }
    }

    /**
     * Başlangıca göre sıralı randevuları kümelere böler: koşan `max(end)` süpürmesi.
     *
     * `>=` bilerek: dokunan aralıklar (bitiş == başlangıç) çakışma DEĞİLDİR ve kümeyi
     * böler. `>` olsaydı arka arkaya dizilmiş bir gün tek bir küme olur ve her randevu
     * 1/N genişliğe inerdi — dolu bir gün okunamaz hâle gelirdi.
     */
    private fun clusters(ordered: List<CalendarEntry>): List<List<CalendarEntry>> {
        val result = mutableListOf<List<CalendarEntry>>()
        var current = mutableListOf<CalendarEntry>()
        var clusterEnd: Instant? = null

        for (entry in ordered) {
            val end = clusterEnd
            if (end != null && entry.startsAt >= end) {
                result += current
                current = mutableListOf()
                clusterEnd = null
            }
            current += entry
            val running = clusterEnd
            clusterEnd = if (running == null) entry.endsAt else maxOf(running, entry.endsAt)
        }
        if (current.isNotEmpty()) result += current

        return result
    }

    /** (y, height) — ızgaranın başlangıcına göre. */
    private fun geometry(
        entry: CalendarEntry,
        clock: BranchClock,
        originMinutes: Int,
    ): Pair<Float, Float> {
        val start = clock.minutesFromMidnight(entry.startsAt) - originMinutes
        val minutes = max(clock.minutes(entry.startsAt, entry.endsAt), MIN_MINUTES)
        return offsetFor(start) to heightFor(minutes)
    }
}
