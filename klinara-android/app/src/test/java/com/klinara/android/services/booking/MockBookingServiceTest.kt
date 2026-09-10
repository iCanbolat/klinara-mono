package com.klinara.android.services.booking

import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.mock.MockClock
import com.klinara.android.services.mock.MockDataScenario
import com.klinara.android.services.mock.MockIds
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * Mock takvimin sunucuyla aynı iki kuralı uyguladığının kanıtı.
 *
 * Mock'ta doğru görünen ama canlıda bozulan bir ekran, mock'un varlık sebebini
 * ortadan kaldırır.
 */
class MockBookingServiceTest {
    private val clock = BranchClock("Europe/Istanbul")
    private val mockClock = MockClock(clock, Instant.parse("2026-09-09T09:00:00Z"))

    private fun service(scenario: MockDataScenario) =
        MockBookingService(scenario, clock, mockClock, latencyEnabled = false)

    private fun today() = clock.localDateString(mockClock.reference)

    @Test
    @DisplayName("Boş gün senaryosu hiçbir randevu üretmez")
    fun emptyDayIsActuallyEmpty() =
        runTest {
            val response = service(MockDataScenario.EmptyDay).calendarDay(query())

            assertTrue(response.appointments.isEmpty())
            assertTrue(response.density.isEmpty())
        }

    @Test
    @DisplayName("Çakışma yoğun senaryosu GERÇEKTEN çakışan bloklar üretir")
    fun conflictHeavyActuallyOverlaps() =
        runTest {
            val entries = service(MockDataScenario.ConflictHeavy).calendarDay(query()).appointments

            val overlapping =
                entries.any { a ->
                    entries.any { b -> a.id != b.id && a.startsAt < b.endsAt && b.startsAt < a.endsAt }
                }
            assertTrue(overlapping, "Bu senaryo yerleşim algoritmasını elle sürmenin tek yolu.")
        }

    @Test
    @DisplayName("Yoğunluk iptal ve gelmedi'yi SAYMAZ")
    fun densityExcludesTerminalEntries() =
        runTest {
            val response = service(MockDataScenario.BusyDay).calendarDay(query())

            val terminalHours =
                response.appointments
                    .filter { it.status.isTerminal }
                    .map { clock.minutesFromMidnight(it.startsAt) / MINUTES_PER_HOUR }
            val densityHours = response.density.filter { it.localDay == today() }.map { it.localHour }

            terminalHours.forEach { hour ->
                val activeAtSameHour =
                    response.appointments.any {
                        !it.status.isTerminal && clock.minutesFromMidnight(it.startsAt) / MINUTES_PER_HOUR == hour
                    }
                if (!activeAtSameHour) {
                    assertTrue(hour !in densityHours, "İptal edilmiş bir saat yoğunluk üretmemeli.")
                }
            }
        }

    @Test
    @DisplayName("Personel filtresi randevuları daraltır ama yoğunluğu DARALTMAZ")
    fun staffFilterNarrowsEntriesButNotDensity() =
        runTest {
            val subject = service(MockDataScenario.BusyDay)
            val all = subject.calendarDay(query())
            val filtered = subject.calendarDay(query(staffProfileId = MockIds.STAFF_ONUR))

            assertTrue(filtered.appointments.size < all.appointments.size, "Filtre randevuları daraltmalı.")
            assertTrue(filtered.appointments.all { MockIds.STAFF_ONUR in it.staffProfileIds })
            assertEquals(all.density, filtered.density, "Isı haritası şube genelidir (sunucudaki davranış).")
        }

    @Test
    @DisplayName("Gün yanıtı yalnız O GÜNÜN randevularını taşır")
    fun dayResponseIsScopedToTheDay() =
        runTest {
            val response = service(MockDataScenario.BusyDay).calendarDay(query())

            assertTrue(response.appointments.isNotEmpty())
            assertTrue(
                response.appointments.all { clock.isSameDay(it.startsAt, mockClock.reference) },
                "Yarı açık aralık [from, to) — komşu günler sızmamalı.",
            )
        }

    @Test
    @DisplayName("Hafta yanıtı yedi günü tek istekte getirir")
    fun weekResponseSpansSevenDays() =
        runTest {
            val weekStart = clock.localDateString(clock.startOfWeek(mockClock.reference))
            val response =
                service(MockDataScenario.BusyDay)
                    .calendarWeek(CalendarWeekQuery(branchId = MockIds.BRANCH_NISANTASI, weekStart = weekStart))

            assertEquals(clock.startOfWeek(mockClock.reference), response.from)
            assertTrue(
                response.appointments.map { clock.localDateString(it.startsAt) }.distinct().size > 1,
                "Tohum dün ve yarını da dolduruyor; hafta boş görünmemeli.",
            )
        }

    @Test
    @DisplayName("Ağ hatası bayrağı takvimi de düşürür")
    fun failingFlagPropagates() =
        runTest {
            val subject = service(MockDataScenario.BusyDay).apply { failing = true }

            val error = runCatching { subject.calendarDay(query()) }.exceptionOrNull()

            assertTrue(error is com.klinara.android.services.networking.ApiError.Network)
        }

    private fun query(staffProfileId: String? = null) =
        CalendarDayQuery(
            branchId = MockIds.BRANCH_NISANTASI,
            date = today(),
            staffProfileId = staffProfileId,
        )

    private companion object {
        const val MINUTES_PER_HOUR = 60
    }
}
