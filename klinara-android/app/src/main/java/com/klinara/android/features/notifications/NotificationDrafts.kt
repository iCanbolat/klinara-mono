package com.klinara.android.features.notifications

import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.notifications.BranchReminderSettings
import com.klinara.android.services.notifications.NotificationChannel
import com.klinara.android.services.notifications.NotificationEvent
import com.klinara.android.services.notifications.NotificationTemplate
import com.klinara.android.services.notifications.NotificationTemplateUpsert
import com.klinara.android.services.notifications.TemplateSegment
import com.klinara.android.services.notifications.ReminderSettingsUpdate

/**
 * Şablon formu (A8.2) — iOS `NotificationTemplateForm` paritesi, saf değer tipi.
 *
 * Müşteri yalnız [isActive]'i değiştirir. Metin, Meta şablon adı/dili ve konumsal eşleme SABİT:
 * WhatsApp'a giden mesaj Meta'da onaylı template'tir, buradaki gövde yalnız kaydın kopyasıdır;
 * düzenlenebilir görünmesi gönderimi değiştirdiği izlenimini verirdi. Kayıt, mevcut değerleri
 * olduğu gibi geri gönderir. `(event, channel, locale)` upsert anahtarıdır.
 */
data class NotificationTemplateForm(
    val event: NotificationEvent,
    val channel: NotificationChannel,
    val locale: String,
    val subject: String,
    val body: String,
    /** Müşteriye giden mesaj: değişkenler mavi `@Etiket` olarak. */
    val segments: List<TemplateSegment>,
    val isActive: Boolean,
    val whatsappTemplateName: String,
    val whatsappTemplateLanguage: String,
    /** Meta'nın `{{1}}, {{2}}…` sırasına karşılık gelen adlar — **sıra anlamlı**, düzenlenmez. */
    val whatsappVariables: List<String>,
    val wasDefault: Boolean,
    private val originalActive: Boolean,
) {
    val isDirty: Boolean get() = isActive != originalActive

    val usesSubject: Boolean get() = channel == NotificationChannel.Email

    val usesWhatsAppTemplate: Boolean get() = channel == NotificationChannel.WhatsApp

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

    companion object {
        private const val DEFAULT_LANGUAGE = "tr"

        fun editing(template: NotificationTemplate): NotificationTemplateForm =
            NotificationTemplateForm(
                event = template.event,
                channel = template.channel,
                locale = template.locale,
                subject = template.subject.orEmpty(),
                body = template.body,
                segments = template.displaySegments,
                isActive = template.isActive,
                whatsappTemplateName = template.whatsappTemplateName.orEmpty(),
                whatsappTemplateLanguage = template.whatsappTemplateLanguage ?: DEFAULT_LANGUAGE,
                whatsappVariables = template.whatsappVariables,
                wasDefault = template.isDefault,
                originalActive = template.isActive,
            )
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
 * hatırlatma yok" değil. Boş taslak kaydedilemez ([isValid]); olayı tamamen kapatmak şablonun
 * "Aktif" anahtarının işi.
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
