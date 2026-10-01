package com.klinara.android.features.notifications

import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.notifications.BranchReminderSettings
import com.klinara.android.services.notifications.NotificationChannel
import com.klinara.android.services.notifications.NotificationEvent
import com.klinara.android.services.notifications.NotificationEventCatalog
import com.klinara.android.services.notifications.NotificationTemplate
import com.klinara.android.services.notifications.TemplateSegment
import com.klinara.android.services.notifications.ReminderSettingsUpdate
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/** iOS `Phase8StoreTests` şablon formu paketi + A8.2'nin iki taslağı. */
class NotificationDraftsTest {
    private fun template(path: String) =
        KlinaraJson.decodeFromString(NotificationTemplate.serializer(), Fixtures.read("notifications/$path"))

    private fun reminderForm(channel: NotificationChannel = NotificationChannel.WhatsApp) =
        NotificationTemplateForm.editing(
            NotificationTemplate(event = NotificationEvent.AppointmentReminder, channel = channel, body = "Merhaba"),
        )

    // --- Şablon formu ---

    @Test
    @DisplayName("Yer tutucular göründükleri sırada ve tekrarsız; boşluklu yazım da tanınır")
    fun placeholderParsing() {
        assertEquals(
            listOf("customerName", "appointmentAt"),
            NotificationEventCatalog.placeholders("{{customerName}} {{ appointmentAt }} {{customerName}}"),
        )
    }

    @Test
    @DisplayName("Gövde düz metin ve @Etiket parçalarına ayrılır; tanımsız ad ham @ad olarak kalır")
    fun segmentsCarryHandles() {
        val segments = NotificationEventCatalog.segments("Sayın {{customerName}}, {{ serviceName }} {{bilinmeyen}}")
        assertEquals(
            listOf(
                TemplateSegment.text("Sayın "),
                TemplateSegment.variable("customerName", "@MüşteriAdı"),
                TemplateSegment.text(", "),
                TemplateSegment.variable("serviceName", "@HizmetAdı"),
                TemplateSegment.text(" "),
                TemplateSegment.variable("bilinmeyen", "@bilinmeyen"),
            ),
            segments,
        )
        assertEquals("Sayın @MüşteriAdı, @HizmetAdı @bilinmeyen", segments.joinToString("") { it.display })
    }

    @Test
    @DisplayName("Sunucunun gönderdiği parçalar gövdeden ayrıştırmaya tercih edilir; yoksa gövde parçalanır")
    fun serverSegmentsWinAndBodyIsTheFallback() {
        val fromServer = template("template-default.json")
        assertTrue(fromServer.segments != null)
        assertTrue(fromServer.displaySegments.any { it.isVariable && it.handle == "@KlinikAdresi" })

        val withoutSegments = fromServer.copy(segments = null, body = "Selam {{customerName}}")
        assertEquals(
            listOf(TemplateSegment.text("Selam "), TemplateSegment.variable("customerName", "@MüşteriAdı")),
            withoutSegments.displaySegments,
        )
    }

    @Test
    @DisplayName("Yalnız Aktif anahtarı formu kirletir; Meta alanları ve metin olduğu gibi geri gider")
    fun onlyActiveIsEditable() {
        val form = template("template-whatsapp.json").let(NotificationTemplateForm::editing)
        assertFalse(form.isDirty)

        val toggled = form.copy(isActive = !form.isActive)
        assertTrue(toggled.isDirty)
        assertFalse(toggled.copy(isActive = form.isActive).isDirty)

        val input = toggled.input()
        assertEquals(form.body, input.body)
        assertEquals(form.whatsappTemplateName.takeIf { it.isNotBlank() }, input.whatsappTemplateName)
        assertEquals(form.whatsappVariables, input.whatsappVariables)
    }

    @Test
    @DisplayName("Konu yalnız e-posta kanalında gövdeye konur; Meta alanları yalnız WhatsApp'ta ve ad varsa")
    fun inputShapeByChannel() {
        val push = reminderForm(NotificationChannel.Push).copy(subject = "Hatırlatma").input()
        assertNull(push.subject, "Sunucu e-posta dışında `subject` anahtarını 422 ile reddediyor")
        assertNull(push.whatsappVariables)

        val email = reminderForm(NotificationChannel.Email).copy(subject = "Hatırlatma").input()
        assertEquals("Hatırlatma", email.subject)

        val whatsappNoName = reminderForm(NotificationChannel.WhatsApp).input()
        assertNull(whatsappNoName.whatsappTemplateName)
        assertNull(whatsappNoName.whatsappTemplateLanguage)
        assertEquals(emptyList<String>(), whatsappNoName.whatsappVariables)
    }

    @Test
    @DisplayName("Varsayılan şablonun `id`'si null; kimlik bileşik anahtardan")
    fun defaultTemplateIdentity() {
        val decoded = template("template-default.json")

        assertNull(decoded.templateId)
        assertTrue(decoded.isDefault)
        assertEquals("appointment_confirmation|whatsapp|tr", decoded.rowId)
    }

    @Test
    @DisplayName("Liste grupları: sunucuda olmayan (olay, kanal) çifti 'Şablon yok' satırı olarak çıkar")
    fun missingChannelsAreSurfaced() {
        val groups =
            NotificationTemplatesViewModel.groups(
                listOf(template("template-default.json")),
            )
        val confirmation = groups.first { it.event == NotificationEvent.AppointmentConfirmation }
        val expiring = groups.first { it.event == NotificationEvent.PackageExpiring }

        // Müşteri olaylarında tek kanal WhatsApp: sunucudan gelen satır var, eksik yok.
        assertEquals(listOf(NotificationChannel.WhatsApp), confirmation.rows.map { it.template.channel })
        assertEquals(listOf(false), confirmation.rows.map { it.isMissing })
        // Standart template'i olmayan olayın WhatsApp satırı 'Şablon yok' olarak çıkar.
        assertEquals(listOf(true), expiring.rows.map { it.isMissing })
    }

    // --- Hatırlatma taslağı ---

    private fun reminderSettings(override: Boolean = false) =
        BranchReminderSettings(
            branchId = "b1",
            reminderHoursBefore = listOf(24, 2),
            isBranchOverride = override,
            noShowFollowupEnabled = true,
            noShowFollowupDelayHours = 2,
        )

    @Test
    @DisplayName("Yalnız takip değişirse saat listesi GÖNDERİLMEZ — iOS'un kazara override hatası")
    fun onlyChangedFieldsAreSent() {
        val draft = ReminderDraft.from(reminderSettings()).copy(followupDelayHours = 6)

        assertEquals(ReminderSettingsUpdate(noShowFollowupDelayHours = 6), draft.update())
    }

    @Test
    @DisplayName("Değişiklik yoksa gövde yok; saat eklenince sıralı liste gider")
    fun hoursChange() {
        val draft = ReminderDraft.from(reminderSettings())
        assertNull(draft.update())
        assertFalse(draft.isDirty)

        val added = draft.adding(48)
        assertEquals(listOf(48, 24, 2), added.update()?.reminderHoursBefore)
    }

    @Test
    @DisplayName("Boş saat listesi kaydedilemez — sunucu `[]`'ı 'override'ı kaldır' okuyor")
    fun emptyHoursAreInvalid() {
        val empty = ReminderDraft.from(reminderSettings()).removing(24).removing(2)

        assertFalse(empty.isValid)
        assertTrue(empty.isDirty)
    }

    @Test
    @DisplayName("Ekle kapısı: 1–720, tekrar yok, en çok beş")
    fun canAddRules() {
        val draft = ReminderDraft.from(reminderSettings())

        assertFalse(draft.canAdd(0))
        assertFalse(draft.canAdd(721))
        assertFalse(draft.canAdd(24))
        assertFalse(draft.canAdd(null))
        assertTrue(draft.canAdd(720))
        val full = draft.adding(1).adding(3).adding(4)
        assertTrue(full.isAtCapacity)
        assertFalse(full.canAdd(5))
    }

    @Test
    @DisplayName("Override yanıtı çözülür: şubenin kendi listesi ve takip gecikmesi")
    fun decodesOverride() {
        val settings =
            KlinaraJson.decodeFromString(
                BranchReminderSettings.serializer(),
                Fixtures.read("notifications/reminder-settings-branch-override.json"),
            )

        assertTrue(settings.isBranchOverride)
        assertEquals(listOf(24, 4), settings.reminderHoursBefore)
        assertEquals(3, settings.noShowFollowupDelayHours)
    }
}
