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
    private fun subject() = MockNotificationsService(latencyEnabled = false)

    private fun upsert(
        body: String,
        channel: NotificationChannel = NotificationChannel.WhatsApp,
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
    @DisplayName("Müşteri olaylarında tek kanal WhatsApp; kiracının şablonu varsayılanın yerinde")
    fun mergedView() =
        runTest {
            val templates = subject().templates()
            val reminder = templates.filter { it.event == NotificationEvent.AppointmentReminder }

            // SMS ve e-posta müşteri olaylarından çıktı: tek satır, kiracının WhatsApp şablonu.
            assertEquals(listOf(NotificationChannel.WhatsApp), reminder.map { it.channel })
            assertTrue(reminder.single().templateId != null && !reminder.single().isDefault)
            val confirmation = templates.single { it.event == NotificationEvent.AppointmentConfirmation }
            assertTrue(confirmation.isDefault)
        }

    @Test
    @DisplayName("Kiracı şablonu varsayılanın YERİNE geçer — listede iki satır kalmaz")
    fun overrideReplacesDefault() =
        runTest {
            val service = subject()
            service.upsertTemplate(upsert("Sayın {{customerName}}"))

            val rows =
                service.templates().filter {
                    it.event == NotificationEvent.AppointmentReminder && it.channel == NotificationChannel.WhatsApp
                }
            assertEquals(1, rows.size)
            assertFalse(rows.single().isDefault)
        }

    @Test
    @DisplayName("Tanımsız değişken TEMPLATE_INVALID; e-posta dışında konu VALIDATION_FAILED")
    fun validations() =
        runTest {
            val service = subject()
            val invalid = runCatching { service.upsertTemplate(upsert("{{packageName}}")) }.exceptionOrNull()
            assertEquals(ApiErrorCode.TEMPLATE_INVALID, (invalid as ApiError).code)
            assertTrue(invalid.displayMessage.contains("customerName"), "detail izinli değişkenleri sayıyor")

            val subjectOnWhatsApp =
                runCatching { service.upsertTemplate(upsert("x", subject = "Konu")) }.exceptionOrNull()
            assertEquals(ApiErrorCode.VALIDATION_FAILED, (subjectOnWhatsApp as ApiError).code)
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
