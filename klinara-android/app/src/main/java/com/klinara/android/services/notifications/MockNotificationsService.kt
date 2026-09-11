package com.klinara.android.services.notifications

import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.booking.BookingService
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.random.Random

/**
 * Bildirim mock'u — iOS `MockNotificationsService` paritesi.
 *
 * Tohum **bilerek boş değil**: bir müşteride zaten kapalı bir kanal var
 * ([MockNotificationsSeed.optOuts]), yoksa "kapalı" hâlin nasıl göründüğü hiç sürülemez.
 *
 * Randevu bildirim planı ([appointmentNotifications]) randevunun kendi saatinden ve
 * şubenin hatırlatma ayarından **türetilir** — sabit bir tablo, ertelenen bir randevuda
 * planı yalan söyletirdi. [booking] bu yüzden kurucuyla bağlanır (§5.1); verilmezse
 * (birim testleri) plan boş döner.
 */
class MockNotificationsService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
    private val booking: BookingService? = null,
    private val now: () -> Instant = Instant::now,
    seedOptOuts: Boolean = true,
) : NotificationsService {
    var failing: Boolean = false

    private val records: MutableList<OptOutRecord> =
        if (seedOptOuts) MockNotificationsSeed.optOuts(now()).toMutableList() else mutableListOf()
    private var idCounter: Int = 0

    /** Şube override'ları — Nişantaşı kendi saatlerini kullanıyor, Bodrum kiracı varsayılanını. */
    private val branchReminderHours: MutableMap<String, List<Int>> =
        mutableMapOf(MockIds.BRANCH_NISANTASI to NISANTASI_REMINDER_HOURS)
    private val branchFollowupEnabled: MutableMap<String, Boolean> = mutableMapOf()
    private val branchFollowupDelay: MutableMap<String, Int> = mutableMapOf()

    override suspend fun appointmentNotifications(appointmentId: String): List<ScheduledNotification> {
        settle()
        val appointment = booking?.appointment(appointmentId) ?: return emptyList()
        val hours = resolvedReminderHours(appointment.branchId)
        val at = now()
        val cancelled = appointment.status == AppointmentStatus.Cancelled
        val reminders =
            hours.sortedDescending().map { offset ->
                val fireAt = appointment.startsAt.minusSeconds(offset * SECONDS_PER_HOUR)
                ScheduledNotification(
                    id = "$appointmentId|reminder|$offset",
                    event = NotificationEvent.AppointmentReminder,
                    offsetHours = offset,
                    scheduledFor = fireAt,
                    // Ek M: iş zamanı gelince koşuyor, satırı `pending` bulamazsa sessizce
                    // çıkıyor. İptal edilmiş randevuda satır bu yüzden `cancelled`, silinmez.
                    status =
                        when {
                            cancelled -> ScheduledNotificationStatus.Cancelled
                            fireAt < at -> ScheduledNotificationStatus.Sent
                            else -> ScheduledNotificationStatus.Pending
                        },
                    messageId = MockNotificationsSeed.MESSAGE_REMINDER_READ.takeIf { !cancelled && fireAt < at },
                )
            }
        val followup =
            if (appointment.status == AppointmentStatus.NoShow && followupEnabled(appointment.branchId)) {
                val delayHours = followupDelay(appointment.branchId)
                val fireAt = appointment.endsAt.plusSeconds(delayHours * SECONDS_PER_HOUR)
                listOf(
                    ScheduledNotification(
                        id = "$appointmentId|followup",
                        event = NotificationEvent.NoShowFollowup,
                        offsetHours = -delayHours,
                        scheduledFor = fireAt,
                        status =
                            if (fireAt < at) ScheduledNotificationStatus.Sent else ScheduledNotificationStatus.Pending,
                    ),
                )
            } else {
                emptyList()
            }
        return reminders + followup
    }

    private fun resolvedReminderHours(branchId: String): List<Int> =
        branchReminderHours[branchId]?.takeIf { it.isNotEmpty() } ?: TENANT_REMINDER_HOURS

    private fun followupEnabled(branchId: String): Boolean = branchFollowupEnabled[branchId] ?: true

    private fun followupDelay(branchId: String): Int = branchFollowupDelay[branchId] ?: DEFAULT_FOLLOWUP_DELAY

    override suspend fun optOuts(customerId: String): List<OptOutRecord> {
        settle()
        return records.filter { it.customerId == customerId }
    }

    override suspend fun createOptOut(
        customerId: String,
        channel: NotificationChannel?,
        source: OptOutSource?,
        note: String?,
    ): OptOutRecord {
        settle()

        // Aynı kapsam iki kez kapatılamaz — sunucuda idempotent; mock'ta da öyle olmalı
        // ki ekran iki özdeş satır çizmesin.
        records.firstOrNull { it.customerId == customerId && it.channel == channel }?.let { return it }

        idCounter += 1
        val record =
            OptOutRecord(
                id = "0970000a-0000-4000-8000-%012d".format(idCounter),
                customerId = customerId,
                channel = channel,
                // Reddin kapsamı HER ZAMAN pazarlama: işlemsel ileti kapatılamaz.
                kind = "marketing",
                source = source ?: OptOutSource.Staff,
                createdAt = Instant.parse(SEED_NOW),
            )
        records += record
        return record
    }

    override suspend fun revokeOptOut(
        customerId: String,
        channel: NotificationChannel?,
    ) {
        settle()

        val removed =
            if (channel == null) {
                records.removeAll { it.customerId == customerId }
            } else {
                records.removeAll { it.customerId == customerId && it.channel == channel }
            }
        if (!removed) throw MockErrors.notFound("İleti reddi")
    }

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    private companion object {
        val TENANT_REMINDER_HOURS = listOf(24, 2)
        val NISANTASI_REMINDER_HOURS = listOf(24, 4)
        const val DEFAULT_FOLLOWUP_DELAY = 2
        const val SECONDS_PER_HOUR = 3_600L
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
        const val SEED_NOW = "2026-09-05T08:30:00Z"
    }
}
