package com.klinara.android.services.notifications

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/** Mock sunucunun dört davranışını taklit ediyor mu (iOS `MockNotificationsService` notu)? */
class MockNotificationSettingsTest {
    private fun subject() = MockNotificationsService(latencyEnabled = false, seedOptOuts = false)

    private fun upsert(
        body: String,
        channel: NotificationChannel = NotificationChannel.Sms,
        subject: String? = null,
    ) = NotificationTemplateUpsert(
        event = NotificationEvent.AppointmentReminder,
        channel = channel,
        locale = "tr",
        subject = subject,
        body = body,
        whatsappTemplateName = null,
        whatsappTemplateLanguage = null,
        whatsappVariables = null,
        isActive = true,
    )

    @Test
    @DisplayName("Varsayılanlar sunucunun kanallarında; kiracının WhatsApp şablonu listenin SONUNDA")
    fun mergedView() =
        runTest {
            val templates = subject().templates()
            val reminder = templates.filter { it.event == NotificationEvent.AppointmentReminder }

            // E-posta müşteri olaylarından çıktı: varsayılan gövde yalnız SMS'te duruyor,
            // kiracının yazdığı WhatsApp şablonu yine sonda.
            assertEquals(
                listOf(NotificationChannel.Sms, NotificationChannel.WhatsApp),
                reminder.map { it.channel },
            )
            assertTrue(reminder.last().templateId != null && !reminder.last().isDefault)
            assertTrue(reminder.first().isDefault)
        }

    @Test
    @DisplayName("Kiracı şablonu varsayılanın YERİNE geçer — listede iki satır kalmaz")
    fun overrideReplacesDefault() =
        runTest {
            val service = subject()
            service.upsertTemplate(upsert("Sayın {{customerName}}"))

            val sms =
                service.templates().filter {
                    it.event == NotificationEvent.AppointmentReminder && it.channel == NotificationChannel.Sms
                }
            assertEquals(1, sms.size)
            assertFalse(sms.single().isDefault)
        }

    @Test
    @DisplayName("Tanımsız değişken TEMPLATE_INVALID; e-posta dışında konu VALIDATION_FAILED")
    fun validations() =
        runTest {
            val service = subject()
            val invalid = runCatching { service.upsertTemplate(upsert("{{packageName}}")) }.exceptionOrNull()
            assertEquals(ApiErrorCode.TEMPLATE_INVALID, (invalid as ApiError).code)
            assertTrue(invalid.displayMessage.contains("customerName"), "detail izinli değişkenleri sayıyor")

            val subjectOnSms = runCatching { service.upsertTemplate(upsert("x", subject = "Konu")) }.exceptionOrNull()
            assertEquals(ApiErrorCode.VALIDATION_FAILED, (subjectOnSms as ApiError).code)
        }

    @Test
    @DisplayName("Şube tercihi kiracı satırının YANINDA durur; eşit uçlar sessiz saati kapatır")
    fun branchPreferenceAndDisabledQuietHours() =
        runTest {
            val service = subject()
            val saved =
                service.upsertPreference(
                    NotificationPreferenceUpsert(
                        branchId = MockIds.BRANCH_NISANTASI,
                        event = NotificationEvent.AppointmentReminder,
                        channels = listOf(NotificationChannel.Sms),
                        quietHoursStart = ClockTime(0, 0),
                        quietHoursEnd = ClockTime(0, 0),
                    ),
                )

            assertFalse(saved.isQuietHoursEnabled)
            val rows = service.preferences().filter { it.event == NotificationEvent.AppointmentReminder }
            assertEquals(2, rows.size)
            assertTrue(rows.first { it.branchId == null }.isQuietHoursEnabled)
        }

    @Test
    @DisplayName("Kayıtlı `null` pencere varsayılana düşer ve AÇIK görünür (sunucunun davranışı)")
    fun nullWindowFallsBackToDefault() =
        runTest {
            val birthday = subject().preferences().first { it.event == NotificationEvent.Birthday }

            assertFalse(birthday.isEnabled, "Tohumda doğum günü kapalı")
            assertEquals("21:00 – 09:00", birthday.quietHoursLabel)
        }

    @Test
    @DisplayName("Kiracı varsayılanındaki şubede yalnız takibi değiştirmek override YAZMAZ")
    fun partialUpdateKeepsTenantDefault() =
        runTest {
            val service = subject()
            val saved =
                service.updateReminderSettings(
                    MockIds.BRANCH_BODRUM,
                    ReminderSettingsUpdate(noShowFollowupDelayHours = 5),
                )

            assertFalse(saved.isBranchOverride)
            assertEquals(listOf(24, 2), saved.reminderHoursBefore)
            assertEquals(5, saved.noShowFollowupDelayHours)
        }

    @Test
    @DisplayName("Boş dizi override'ı KALDIRIR; sınır dışı saat alan hatası")
    fun resetAndBounds() =
        runTest {
            val service = subject()
            assertTrue(service.reminderSettings(MockIds.BRANCH_NISANTASI).isBranchOverride)

            val reset = service.updateReminderSettings(MockIds.BRANCH_NISANTASI, ReminderSettingsUpdate.RESET_TO_TENANT)
            assertFalse(reset.isBranchOverride)
            assertEquals(listOf(24, 2), reset.reminderHoursBefore)

            val tooFar =
                runCatching {
                    service.updateReminderSettings(MockIds.BRANCH_NISANTASI, ReminderSettingsUpdate(listOf(800)))
                }.exceptionOrNull() as ApiError
            assertNotNull(tooFar.fieldErrors["reminderHoursBefore"])
        }
}
