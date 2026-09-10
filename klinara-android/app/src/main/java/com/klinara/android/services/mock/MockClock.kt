package com.klinara.android.services.mock

import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.ClockTime
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong

/**
 * Mock verisi için deterministik zaman.
 *
 * [reference] şube diliminde bugün **23:30**'dur. Bilerek gün sonu: "bugün" sınırıyla
 * ilgili hatalar (yarın gösterilen randevu, kayan tarih şeridi) ancak orada yüzeye çıkar.
 *
 * [next] monotonik artar, böylece oluşturulan kayıtlar deterministik sıralanır ve imleç
 * gidiş-dönüşü tam saniyede kalır.
 */
class MockClock(
    private val clock: BranchClock = BranchClock("Europe/Istanbul"),
    now: Instant = Instant.now(),
) {
    val reference: Instant =
        clock.date(clock.startOfDay(now), REFERENCE_TIME)

    private val tick = AtomicLong(0)

    fun next(): Instant = reference.plusSeconds(tick.incrementAndGet())

    private companion object {
        /** Gün sonu bilerek: "bugün" sınır hataları ancak burada yüzeye çıkar. */
        val REFERENCE_TIME = ClockTime(hour = 23, minute = 30)
    }
}
