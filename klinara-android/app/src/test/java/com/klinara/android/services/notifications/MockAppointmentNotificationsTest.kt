package com.klinara.android.services.notifications

import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.booking.CalendarDayQuery
import com.klinara.android.services.booking.MockBookingService
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

/** Mock plan randevunun kendi saatinden ve şubenin hatırlatma ayarından TÜRÜYOR (iOS paritesi). */
class MockAppointmentNotificationsTest {
    private val clock = BranchClock("Europe/Istanbul")
    private val mockClock = MockClock(clock, Instant.parse("2026-09-09T09:00:00Z"))
    private val booking = MockBookingService(MockDataScenario.BusyDay, clock, mockClock, latencyEnabled = false)

    private fun subject(now: Instant) =
        MockNotificationsService(latencyEnabled = false, booking = booking, now = { now }, seedOptOuts = false)

    private suspend fun firstAppointmentId(): String =
        booking
            .calendarDay(
                CalendarDayQuery(
                    branchId = MockIds.BRANCH_NISANTASI,
                    date = clock.localDateString(mockClock.reference),
                ),
            ).appointments
            .first { !it.status.isTerminal }
            .id

    @Test
    @DisplayName("Nişantaşı override'ı (24 + 4 saat) randevu saatinden geriye sayılır, en uzak önce")
    fun remindersFollowBranchOverride() =
        runTest {
            val id = firstAppointmentId()
            val appointment = booking.appointment(id)
            val rows = subject(appointment.startsAt.minusSeconds(48 * 3_600)).appointmentNotifications(id)

            assertEquals(listOf(24, 4), rows.map { it.offsetHours })
            assertEquals(appointment.startsAt.minusSeconds(24 * 3_600), rows.first().scheduledFor)
            assertTrue(rows.all { it.status == ScheduledNotificationStatus.Pending })
        }

    @Test
    @DisplayName("İptal edilen randevunun planı SİLİNMEZ, `cancelled` görünür")
    fun cancelledAppointmentKeepsRows() =
        runTest {
            val id = firstAppointmentId()
            booking.cancel(id, reason = null)

            val rows = subject(Instant.parse("2026-09-01T00:00:00Z")).appointmentNotifications(id)

            assertEquals(2, rows.size)
            assertTrue(rows.all { it.status == ScheduledNotificationStatus.Cancelled })
        }

    @Test
    @DisplayName("Gelmedi işaretlenen randevuya takip satırı eklenir — negatif offset")
    fun noShowAddsFollowup() =
        runTest {
            val id = firstAppointmentId()
            booking.changeStatus(id, AppointmentStatus.NoShow)

            val rows = subject(Instant.parse("2026-09-01T00:00:00Z")).appointmentNotifications(id)
            val followup = rows.last()

            assertEquals(NotificationEvent.NoShowFollowup, followup.event)
            assertEquals(-2, followup.offsetHours)
            assertTrue(followup.isFollowup)
        }
}
