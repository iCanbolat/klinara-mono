package com.klinara.android.features.notifications

import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.notifications.BranchReminderSettings
import com.klinara.android.services.notifications.NotificationChannel
import com.klinara.android.services.notifications.NotificationEvent
import com.klinara.android.services.notifications.NotificationEventCatalog
import com.klinara.android.services.notifications.NotificationPreference
import com.klinara.android.services.notifications.NotificationTemplate
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

    private fun preference(path: String) =
        KlinaraJson.decodeFromString(NotificationPreference.serializer(), Fixtures.read("notifications/$path"))

    private fun reminderForm(channel: NotificationChannel = NotificationChannel.Sms) =
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
    @DisplayName("Başka bir olayın değişkeni bu olayda geçersiz — sunucuya gitmeden yakalanır")
    fun foreignVariableIsUnknown() {
        val form = reminderForm().copy(body = "{{packageName}} için {{customerName}}")

        assertEquals(listOf("packageName"), form.unknownPlaceholders)
        assertFalse(form.isValid)
    }

    @Test
    @DisplayName("WhatsApp konumsal değişkenleri de aynı beyaz listeye tabi")
    fun whatsappVariablesAreChecked() {
        val form =
            reminderForm(NotificationChannel.WhatsApp)
                .addingWhatsAppVariable("customerName")
                .addingWhatsAppVariable("remainingSessions")

        assertEquals(listOf("remainingSessions"), form.unknownPlaceholders)
    }

    @Test
    @DisplayName("Boş ya da 4000 karakteri aşan gövde kaydedilemez")
    fun bodyBounds() {
        assertFalse(reminderForm().copy(body = "   ").isValid)
        assertFalse(reminderForm().copy(body = "a".repeat(NotificationTemplateForm.MAX_BODY + 1)).isValid)
        assertTrue(reminderForm().copy(body = "a".repeat(NotificationTemplateForm.MAX_BODY)).isValid)
    }

    @Test
    @DisplayName("Meta şablon adı verildiyse dil de zorunlu")
    fun templateNameNeedsLanguage() {
        val form =
            reminderForm(NotificationChannel.WhatsApp)
                .copy(whatsappTemplateName = "randevu", whatsappTemplateLanguage = "")

        assertFalse(form.isValid)
        assertTrue(form.copy(whatsappTemplateLanguage = "tr").isValid)
    }

    @Test
    @DisplayName("Konu yalnız e-posta kanalında gövdeye konur; Meta alanları yalnız WhatsApp'ta ve ad varsa")
    fun inputShapeByChannel() {
        val sms = reminderForm().copy(subject = "Hatırlatma").input()
        assertNull(sms.subject, "Sunucu e-posta dışında `subject` anahtarını 422 ile reddediyor")
        assertNull(sms.whatsappVariables)

        val email = reminderForm(NotificationChannel.Email).copy(subject = "Hatırlatma").input()
        assertEquals("Hatırlatma", email.subject)

        val whatsappNoName = reminderForm(NotificationChannel.WhatsApp).input()
        assertNull(whatsappNoName.whatsappTemplateName)
        assertNull(whatsappNoName.whatsappTemplateLanguage)
        assertEquals(emptyList<String>(), whatsappNoName.whatsappVariables)
    }

    @Test
    @DisplayName("Değişken eklemek formu kirletir; konumsal sıra korunur, aynı ad iki kez eklenmez")
    fun variableOrderAndDirty() {
        val form = template("template-whatsapp.json").let(NotificationTemplateForm::editing)
        assertFalse(form.isDirty)

        val appended = form.appendingVariable("branchName")
        assertTrue(appended.isDirty)
        assertTrue(appended.body.endsWith("{{branchName}}"))

        val reordered = form.removingWhatsAppVariable(0).addingWhatsAppVariable(form.whatsappVariables.first())
        assertEquals(form.whatsappVariables.drop(1) + form.whatsappVariables.first(), reordered.whatsappVariables)
        assertEquals(reordered, reordered.addingWhatsAppVariable(form.whatsappVariables.first()))
    }

    @Test
    @DisplayName("Varsayılan şablonun `id`'si null; kimlik bileşik anahtardan")
    fun defaultTemplateIdentity() {
        val decoded = template("template-default.json")

        assertNull(decoded.templateId)
        assertTrue(decoded.isDefault)
        assertEquals("appointment_confirmation|sms|tr", decoded.rowId)
    }

    @Test
    @DisplayName("Liste grupları: sunucuda olmayan (olay, kanal) çifti 'Şablon yok' satırı olarak çıkar")
    fun missingChannelsAreSurfaced() {
        val groups =
            NotificationTemplatesViewModel.groups(
                listOf(template("template-default.json")),
            )
        val confirmation = groups.first { it.event == NotificationEvent.AppointmentConfirmation }

        assertEquals(
            listOf(NotificationChannel.WhatsApp, NotificationChannel.Sms, NotificationChannel.Email),
            confirmation.rows.map { it.template.channel },
            "Katalog sırası: WhatsApp önce",
        )
        assertEquals(listOf(true, false, true), confirmation.rows.map { it.isMissing })
    }

    // --- Tercih taslağı ---

    @Test
    @DisplayName("Sessiz saat kapalıyken EŞİT uçlar gider (00:00–00:00) — [S] A8.2 sözleşmesi")
    fun disabledQuietHoursSendEqualEnds() {
        val draft = PreferenceDraft.editing(preference("preference-saved.json")).copy(quietHoursEnabled = false)
        val input = draft.input(activeBranchId = "b1")

        assertEquals(ClockTime(0, 0), input.quietHoursStart)
        assertEquals(input.quietHoursStart, input.quietHoursEnd)
        assertNull(input.branchId, "Kiracı kapsamında şube kimliği gönderilmez")
        assertTrue(draft.isDirty)
    }

    @Test
    @DisplayName("Açıkken iki uç birlikte; eşit uçlar açıkken geçersiz, gece yarısı aşımı hata değil")
    fun quietHoursPair() {
        val draft = PreferenceDraft.editing(preference("preference-saved.json"))

        assertTrue(draft.quietHoursEnabled)
        assertTrue(draft.crossesMidnight, "22:00–08:00")
        assertTrue(draft.isValid)
        assertFalse(draft.copy(quietEnd = draft.quietStart).isValid)
        assertEquals("22:00", draft.input(null).quietHoursStart.wireValue)
    }

    @Test
    @DisplayName("Eski sunucu `quietHoursEnabled` göndermese de eşit uçlar kapalı okunur")
    fun legacyEqualEndsAreDisabled() {
        val legacy =
            NotificationPreference(
                event = NotificationEvent.Birthday,
                quietHoursStart = "00:00",
                quietHoursEnd = "00:00",
            )

        assertFalse(legacy.isQuietHoursEnabled)
        assertNull(legacy.quietHoursLabel)
        assertFalse(PreferenceDraft.editing(legacy).quietHoursEnabled)
    }

    @Test
    @DisplayName("Kanal sırası taşınır; ilk kanal yukarı gitmez; şube kapsamı şube kimliğini gönderir")
    fun channelOrdering() {
        val draft = PreferenceDraft.editing(preference("preference-saved.json"))

        val moved = draft.movingUp(NotificationChannel.Sms)
        assertEquals(listOf(NotificationChannel.Sms, NotificationChannel.WhatsApp), moved.channels)
        assertEquals(moved, moved.movingUp(NotificationChannel.Sms))
        assertEquals(listOf(NotificationChannel.Email, NotificationChannel.Push), draft.availableChannels)
        assertEquals("b1", moved.copy(isBranchScope = true).input("b1").branchId)
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
