package com.klinara.android.services.notifications

import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.contracts.ApiErrorCode
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

    // --- Şablonlar (A8.2) ---

    private val templateRecords: MutableList<NotificationTemplate> =
        MockNotificationsSeed.tenantTemplates().toMutableList()
    private val preferenceRecords: MutableList<NotificationPreference> =
        MockNotificationsSeed.tenantPreferences().toMutableList()
    private var recordCounter: Int = 0

    /** Sunucunun birleştirmesi: kod varsayılanları + kiracı satırları; varsayılanı olmayan kanal SONA. */
    override suspend fun templates(): List<NotificationTemplate> {
        settle()
        val merged = MockNotificationsSeed.defaultTemplates().toMutableList()
        templateRecords.forEach { record ->
            val index = merged.indexOfFirst { it.rowId == record.rowId }
            if (index >= 0) merged[index] = record else merged += record
        }
        return merged
    }

    override suspend fun upsertTemplate(input: NotificationTemplateUpsert): NotificationTemplate {
        settle()
        // Sunucu `subject !== undefined` diyor: e-posta dışında anahtarın varlığı yeter.
        if (input.channel != NotificationChannel.Email && input.subject != null) {
            throw MockErrors.problem(
                ApiErrorCode.VALIDATION_FAILED,
                "Konu alanı yalnız e-posta kanalında kullanılır",
                MockErrors.HTTP_UNPROCESSABLE,
            )
        }
        val allowed = NotificationEventCatalog.variables(input.event)
        val used =
            NotificationEventCatalog.placeholders(input.body) +
                NotificationEventCatalog.placeholders(input.subject.orEmpty()) +
                input.whatsappVariables.orEmpty()
        val unknown = used.filterNot { it in allowed }.distinct()
        if (unknown.isNotEmpty()) {
            throw MockErrors.problem(
                ApiErrorCode.TEMPLATE_INVALID,
                "Bu olayda tanımlı olmayan değişken: ${unknown.joinToString(", ")}",
                MockErrors.HTTP_UNPROCESSABLE,
                "Kullanılabilir değişkenler: ${allowed.joinToString(", ")}",
            )
        }
        val key = "${input.event.wire}|${input.channel.wire}|${input.locale}"
        val existing = templateRecords.firstOrNull { it.rowId == key }
        val saved =
            NotificationTemplate(
                templateId = existing?.templateId ?: nextId(TEMPLATE_ID),
                event = input.event,
                channel = input.channel,
                locale = input.locale,
                kind = NotificationEventCatalog.kind(input.event),
                subject = input.subject,
                body = input.body,
                whatsappTemplateName = input.whatsappTemplateName,
                whatsappTemplateLanguage = input.whatsappTemplateLanguage,
                whatsappVariables = input.whatsappVariables.orEmpty(),
                isActive = input.isActive,
                isDefault = false,
                variables = NotificationEventCatalog.placeholders(input.body),
            )
        templateRecords.removeAll { it.rowId == key }
        templateRecords += saved
        return saved
    }

    // --- Tercihler (A8.2) ---

    /** Kiracı satırı olmayan her olay için sentez + tüm kayıtlı satırlar; olay adına göre sıralı. */
    override suspend fun preferences(): List<NotificationPreference> {
        settle()
        val covered = preferenceRecords.filter { it.branchId == null }.map { it.event }.toSet()
        val defaults =
            NotificationEvent.selectable.filterNot { it in covered }.map { event ->
                NotificationPreference(
                    event = event,
                    kind = NotificationEventCatalog.kind(event),
                    channels = NotificationEventCatalog.channels(event),
                    quietHoursStart = DEFAULT_QUIET_START,
                    quietHoursEnd = DEFAULT_QUIET_END,
                    quietHoursEnabled = true,
                    isDefault = true,
                )
            }
        return (defaults + preferenceRecords.map { it.resolved() }).sortedBy { it.event.wire }
    }

    override suspend fun upsertPreference(input: NotificationPreferenceUpsert): NotificationPreference {
        settle()
        val existing =
            preferenceRecords.firstOrNull { it.event == input.event && it.branchId == input.branchId }
        val saved =
            NotificationPreference(
                preferenceId = existing?.preferenceId ?: nextId(PREFERENCE_ID),
                branchId = input.branchId,
                event = input.event,
                kind = NotificationEventCatalog.kind(input.event),
                channels = input.channels,
                quietHoursStart = input.quietHoursStart.wireValue,
                quietHoursEnd = input.quietHoursEnd.wireValue,
            )
        preferenceRecords.removeAll { it.event == input.event && it.branchId == input.branchId }
        preferenceRecords += saved
        return saved.resolved()
    }

    /** Sunucunun `toPreferenceResponse`'u: kayıtlı `null` pencere varsayılana düşer; eşit uçlar = kapalı. */
    private fun NotificationPreference.resolved(): NotificationPreference {
        val start = quietHoursStart ?: DEFAULT_QUIET_START
        val end = quietHoursEnd ?: DEFAULT_QUIET_END
        return copy(quietHoursStart = start, quietHoursEnd = end, quietHoursEnabled = start != end, isDefault = false)
    }

    // --- Hatırlatma ayarları (A8.2) ---

    override suspend fun reminderSettings(branchId: String): BranchReminderSettings {
        settle()
        return resolvedReminderSettings(branchId)
    }

    override suspend fun updateReminderSettings(
        branchId: String,
        update: ReminderSettingsUpdate,
    ): BranchReminderSettings {
        settle()
        update.reminderHoursBefore?.let { hours ->
            if (hours.size > BranchReminderSettings.MAX_REMINDER_COUNT) {
                throw MockErrors.validation("reminderHoursBefore", "En çok 5 hatırlatma saati tanımlanabilir")
            }
            if (hours.any { it !in BranchReminderSettings.HOUR_RANGE }) {
                throw MockErrors.validation("reminderHoursBefore", "Hatırlatma saatleri 1 ile 720 arasında olmalı")
            }
            // Boş dizi override'ı KALDIRIR — sunucuyla aynı yorum.
            branchReminderHours[branchId] = hours
        }
        update.noShowFollowupEnabled?.let { branchFollowupEnabled[branchId] = it }
        update.noShowFollowupDelayHours?.let { delay ->
            if (delay !in BranchReminderSettings.FOLLOWUP_DELAY_RANGE) {
                throw MockErrors.validation(
                    "noShowFollowupDelayHours",
                    "Takip gecikmesi 0 ile 168 saat arasında olmalı",
                )
            }
            branchFollowupDelay[branchId] = delay
        }
        return resolvedReminderSettings(branchId)
    }

    private fun resolvedReminderSettings(branchId: String): BranchReminderSettings {
        val override = branchReminderHours[branchId].orEmpty()
        return BranchReminderSettings(
            branchId = branchId,
            reminderHoursBefore = override.ifEmpty { TENANT_REMINDER_HOURS },
            isBranchOverride = override.isNotEmpty(),
            noShowFollowupEnabled = followupEnabled(branchId),
            noShowFollowupDelayHours = followupDelay(branchId),
        )
    }

    private fun nextId(prefix: String): String {
        recordCounter += 1
        return "$prefix-0000-4000-8000-%012d".format(recordCounter)
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
        const val DEFAULT_QUIET_START = "21:00"
        const val DEFAULT_QUIET_END = "09:00"
        const val TEMPLATE_ID = "e4100000"
        const val PREFERENCE_ID = "e5100000"
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
        const val SEED_NOW = "2026-09-05T08:30:00Z"
    }
}
