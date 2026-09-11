package com.klinara.android.features.notifications

import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.notifications.BranchReminderSettings
import com.klinara.android.services.notifications.NotificationChannel
import com.klinara.android.services.notifications.NotificationEvent
import com.klinara.android.services.notifications.NotificationEventCatalog
import com.klinara.android.services.notifications.NotificationPreference
import com.klinara.android.services.notifications.NotificationPreferenceUpsert
import com.klinara.android.services.notifications.NotificationTemplate
import com.klinara.android.services.notifications.NotificationTemplateUpsert
import com.klinara.android.services.notifications.ReminderSettingsUpdate

/**
 * Şablon formu (A8.2) — iOS `NotificationTemplateForm` paritesi, saf değer tipi.
 *
 * Yer tutucu doğrulaması **burada**, sunucunun 422'sini beklemeden: kullanıcı hatayı kaydete
 * basınca değil, yazarken görmeli. `(event, channel, locale)` upsert anahtarı olduğu için
 * değiştirilemez — değişseydi kullanıcı "bu şablonu düzenledim" sanırken yeni bir satır açardı.
 */
data class NotificationTemplateForm(
    val event: NotificationEvent,
    val channel: NotificationChannel,
    val locale: String,
    val subject: String,
    val body: String,
    val isActive: Boolean,
    val whatsappTemplateName: String,
    val whatsappTemplateLanguage: String,
    /** Meta'nın `{{1}}, {{2}}…` sırasına karşılık gelen adlar — **sıra anlamlı**. */
    val whatsappVariables: List<String>,
    val wasDefault: Boolean,
    private val original: Snapshot,
) {
    /** Kirli izlemesi için açılıştaki değerler. */
    data class Snapshot(
        val subject: String,
        val body: String,
        val isActive: Boolean,
        val templateName: String,
        val templateLanguage: String,
        val variables: List<String>,
    )

    val allowedVariables: List<String> get() = NotificationEventCatalog.variables(event)

    val usesSubject: Boolean get() = channel == NotificationChannel.Email

    val usesWhatsAppTemplate: Boolean get() = channel == NotificationChannel.WhatsApp

    /** Gövdede, e-postada konuda ve WhatsApp eşlemesinde geçen ama tanımlı olmayan adlar (sıralı). */
    val unknownPlaceholders: List<String>
        get() {
            val allowed = allowedVariables.toSet()
            val unknown =
                NotificationEventCatalog.unknownPlaceholders(body, event) +
                    (if (usesSubject) NotificationEventCatalog.unknownPlaceholders(subject, event) else emptyList()) +
                    (if (usesWhatsAppTemplate) whatsappVariables.filterNot { it in allowed } else emptyList())
            return unknown.distinct().sorted()
        }

    val isDirty: Boolean
        get() = snapshot() != original

    val isValid: Boolean
        get() {
            val trimmed = body.trim()
            if (trimmed.isEmpty() || trimmed.length > MAX_BODY) return false
            if (unknownPlaceholders.isNotEmpty()) return false
            // Template adı verildiyse dil de verilmeli: Meta ikisini birlikte istiyor.
            return !(usesWhatsAppTemplate && whatsappTemplateName.isNotBlank() && whatsappTemplateLanguage.isBlank())
        }

    /**
     * Metnin SONUNA ekler: imleç konumuna eklemek için alanın seçimini okumak gerekirdi ve
     * yanlış yere eklemek hiç eklememekten kötü (iOS ile aynı karar).
     */
    fun appendingVariable(name: String): NotificationTemplateForm = copy(body = body + "{{$name}}")

    fun addingWhatsAppVariable(name: String): NotificationTemplateForm =
        if (name in whatsappVariables) this else copy(whatsappVariables = whatsappVariables + name)

    fun removingWhatsAppVariable(index: Int): NotificationTemplateForm =
        if (index !in whatsappVariables.indices) {
            this
        } else {
            copy(whatsappVariables = whatsappVariables.filterIndexed { i, _ -> i != index })
        }

    /** Gövde: konu yalnız e-postada ve boş değilse; Meta alanları yalnız WhatsApp'ta ve ad varsa. */
    fun input(): NotificationTemplateUpsert {
        val hasTemplateName = usesWhatsAppTemplate && whatsappTemplateName.isNotBlank()
        return NotificationTemplateUpsert(
            event = event,
            channel = channel,
            locale = locale,
            subject = subject.takeIf { usesSubject && it.isNotBlank() },
            body = body,
            whatsappTemplateName = whatsappTemplateName.trim().takeIf { hasTemplateName },
            whatsappTemplateLanguage = whatsappTemplateLanguage.trim().takeIf { hasTemplateName },
            whatsappVariables = whatsappVariables.takeIf { usesWhatsAppTemplate },
            isActive = isActive,
        )
    }

    private fun snapshot() =
        Snapshot(subject, body, isActive, whatsappTemplateName, whatsappTemplateLanguage, whatsappVariables)

    companion object {
        const val MAX_BODY = 4000
        private const val DEFAULT_LANGUAGE = "tr"

        fun editing(template: NotificationTemplate): NotificationTemplateForm {
            val snapshot =
                Snapshot(
                    subject = template.subject.orEmpty(),
                    body = template.body,
                    isActive = template.isActive,
                    templateName = template.whatsappTemplateName.orEmpty(),
                    templateLanguage = template.whatsappTemplateLanguage ?: DEFAULT_LANGUAGE,
                    variables = template.whatsappVariables,
                )
            return NotificationTemplateForm(
                event = template.event,
                channel = template.channel,
                locale = template.locale,
                subject = snapshot.subject,
                body = snapshot.body,
                isActive = snapshot.isActive,
                whatsappTemplateName = snapshot.templateName,
                whatsappTemplateLanguage = snapshot.templateLanguage,
                whatsappVariables = snapshot.variables,
                wasDefault = template.isDefault,
                original = snapshot,
            )
        }
    }
}

/**
 * Tercih taslağı (A8.2) — kanal önceliği ve sessiz saat.
 *
 * Kanal listesi **sıralı**: sunucu "öncelik sırasında dene, ilk başarılıda dur" diye okuyor.
 * Sessiz saatin iki ucu her zaman birlikte gider; kapalıyken **eşit uçlar** (`00:00`–`00:00`)
 * — [S] A8.2 sözleşmesi. iOS kapalıyken iki ucu da atlıyordu ve sunucu varsayılana düştüğü için
 * kaydedilen satır yeniden "21:00 – 09:00" diye açılıyordu.
 */
data class PreferenceDraft(
    val event: NotificationEvent,
    val channels: List<NotificationChannel>,
    val isBranchScope: Boolean,
    val quietHoursEnabled: Boolean,
    val quietStart: ClockTime,
    val quietEnd: ClockTime,
    private val original: PreferenceDraft? = null,
) {
    val isDirty: Boolean get() = original != null && copy(original = null) != original

    /** Eklenebilecek kanallar — sunucunun `ALL_CHANNELS` kümesinden seçilmemiş olanlar. */
    val availableChannels: List<NotificationChannel>
        get() = NotificationChannel.all.filterNot { it in channels }

    /** Pencere gece yarısını aşıyor mu (21:00–09:00)? Bir hata değil; ekran açıkça söyler. */
    val crossesMidnight: Boolean get() = quietHoursEnabled && quietEnd <= quietStart && quietEnd != quietStart

    /** Açıkken eşit uçlar "kapalı" demek olurdu — kullanıcı açık sanıp kapatmış olmasın. */
    val isValid: Boolean get() = !quietHoursEnabled || quietStart != quietEnd

    fun movingUp(channel: NotificationChannel): PreferenceDraft {
        val index = channels.indexOf(channel)
        if (index <= 0) return this
        val reordered = channels.toMutableList().apply { add(index - 1, removeAt(index)) }
        return copy(channels = reordered)
    }

    fun removing(channel: NotificationChannel): PreferenceDraft = copy(channels = channels - channel)

    fun adding(channel: NotificationChannel): PreferenceDraft =
        if (channel in channels) this else copy(channels = channels + channel)

    fun input(activeBranchId: String?): NotificationPreferenceUpsert =
        NotificationPreferenceUpsert(
            branchId = activeBranchId.takeIf { isBranchScope },
            event = event,
            channels = channels,
            quietHoursStart = if (quietHoursEnabled) quietStart else DISABLED,
            quietHoursEnd = if (quietHoursEnabled) quietEnd else DISABLED,
        )

    companion object {
        /** Boş pencere: sunucuda `isQuietHour` `start === end` için `false`. */
        val DISABLED = ClockTime(0, 0)
        private val DEFAULT_START = ClockTime(21, 0)
        private val DEFAULT_END = ClockTime(9, 0)

        fun editing(preference: NotificationPreference): PreferenceDraft {
            val enabled = preference.isQuietHoursEnabled
            val draft =
                PreferenceDraft(
                    event = preference.event,
                    channels = preference.channels.filter { it != NotificationChannel.Unknown },
                    isBranchScope = preference.branchId != null,
                    quietHoursEnabled = enabled,
                    // Kapalı satırda saatler 00:00 gelir; anahtar açılınca makul bir pencere önerilsin.
                    quietStart = ClockTime.parse(preference.quietHoursStart)?.takeIf { enabled } ?: DEFAULT_START,
                    quietEnd = ClockTime.parse(preference.quietHoursEnd)?.takeIf { enabled } ?: DEFAULT_END,
                )
            return draft.copy(original = draft)
        }
    }
}

/**
 * Hatırlatma ayarı taslağı (A8.2).
 *
 * **Yalnız değişen alanlar gönderilir** ([update]). iOS her kayıtta saat listesini gönderiyor:
 * kiracı varsayılanını kullanan bir şubede yalnız gelmedi takibini değiştirmek, kiracı
 * saatlerini o şubeye KAZARA override olarak yazıyordu.
 *
 * Saat listesi hiçbir zaman boş gönderilmez: sunucu `[]`'ı "override'ı kaldır" okur, "hiç
 * hatırlatma yok" değil. Boş taslak kaydedilemez ([isValid]); olayı tamamen kapatmak bildirim
 * tercihinin işi.
 */
data class ReminderDraft(
    val hours: List<Int>,
    val followupEnabled: Boolean,
    val followupDelayHours: Int,
    private val original: ReminderDraft? = null,
) {
    val sortedHours: List<Int> get() = hours.sortedDescending()

    val isDirty: Boolean get() = original != null && update() != null

    val isAtCapacity: Boolean get() = hours.size >= BranchReminderSettings.MAX_REMINDER_COUNT

    val isValid: Boolean
        get() =
            hours.isNotEmpty() &&
                hours.size <= BranchReminderSettings.MAX_REMINDER_COUNT &&
                hours.all { it in BranchReminderSettings.HOUR_RANGE } &&
                followupDelayHours in BranchReminderSettings.FOLLOWUP_DELAY_RANGE

    /** "Ekle" etkin mi — 1–720, tekrar yok, en çok beş. */
    fun canAdd(value: Int?): Boolean =
        value != null && value in BranchReminderSettings.HOUR_RANGE && value !in hours && !isAtCapacity

    fun adding(value: Int): ReminderDraft = if (canAdd(value)) copy(hours = hours + value) else this

    fun removing(value: Int): ReminderDraft = copy(hours = hours - value)

    /** Açılıştan bu yana değişen alanlar; hiçbiri değişmediyse `null`. */
    fun update(): ReminderSettingsUpdate? {
        val base = original ?: return null
        val changed =
            ReminderSettingsUpdate(
                reminderHoursBefore = sortedHours.takeIf { it != base.sortedHours },
                noShowFollowupEnabled = followupEnabled.takeIf { it != base.followupEnabled },
                noShowFollowupDelayHours = followupDelayHours.takeIf { it != base.followupDelayHours },
            )
        return changed.takeUnless { it.isEmpty }
    }

    companion object {
        fun from(settings: BranchReminderSettings): ReminderDraft {
            val draft =
                ReminderDraft(
                    hours = settings.reminderHoursBefore,
                    followupEnabled = settings.noShowFollowupEnabled,
                    followupDelayHours = settings.noShowFollowupDelayHours,
                )
            return draft.copy(original = draft)
        }
    }
}
