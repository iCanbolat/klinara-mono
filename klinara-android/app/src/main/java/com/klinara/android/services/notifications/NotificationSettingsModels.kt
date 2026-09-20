package com.klinara.android.services.notifications

import com.klinara.android.services.formatting.ClockTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Kaynak: `apps/api/src/modules/notifications/dto/notification.dto.ts`, `reminder.dto.ts` ve
// `default-templates.ts`; iOS `NotificationModels.swift` / `ReminderModels.swift` paritesi.

/**
 * Olay → tür, varsayılan kanal önceliği ve izinli değişkenler; `default-templates.ts`'in aynası.
 *
 * İstemcide durmasının tek sebebi bir kullanıcı deneyimi kararı: şablon editörü `{{…}}` yer
 * tutucularını **yazarken** doğrulayabilsin. Sunucu yine son söz sahibi (`TEMPLATE_INVALID`);
 * bu tablo bir kolaylık, bir yetki değil.
 */
object NotificationEventCatalog {
    data class Definition(
        val kind: NotificationKind,
        val channels: List<NotificationChannel>,
        val variables: List<String>,
    )

    // Müşteriye e-posta GİTMEZ: klinik müşterisiyle yalnız WhatsApp üzerinden yazışır.
    // `StaffInternal` bir istisna değil, farklı bir alıcı — personele giden iç bildirim.
    private val whatsappSms = listOf(NotificationChannel.WhatsApp, NotificationChannel.Sms)
    private val appointmentVariables = listOf("customerName", "branchName", "appointmentAt", "serviceName")

    val definitions: Map<NotificationEvent, Definition> =
        mapOf(
            NotificationEvent.AppointmentConfirmation to
                Definition(NotificationKind.Transactional, whatsappSms, appointmentVariables),
            NotificationEvent.AppointmentReminder to
                Definition(NotificationKind.Transactional, whatsappSms, appointmentVariables),
            NotificationEvent.AppointmentCancelled to
                Definition(
                    NotificationKind.Transactional,
                    whatsappSms,
                    listOf("customerName", "branchName", "appointmentAt"),
                ),
            NotificationEvent.NoShowFollowup to
                Definition(NotificationKind.Transactional, whatsappSms, listOf("customerName", "branchName")),
            NotificationEvent.PackageBalance to
                Definition(
                    NotificationKind.Transactional,
                    whatsappSms,
                    listOf("customerName", "packageName", "remainingSessions"),
                ),
            NotificationEvent.PackageExpiring to
                Definition(
                    NotificationKind.Transactional,
                    whatsappSms,
                    listOf("customerName", "packageName", "expiresAt", "remainingSessions"),
                ),
            NotificationEvent.Birthday to
                Definition(NotificationKind.Marketing, whatsappSms, listOf("customerName", "branchName")),
            NotificationEvent.AutoReply to
                Definition(NotificationKind.Transactional, whatsappSms, listOf("message")),
            NotificationEvent.StaffInternal to
                Definition(
                    NotificationKind.Transactional,
                    listOf(NotificationChannel.Email),
                    listOf("subject", "message"),
                ),
        )

    fun variables(event: NotificationEvent): List<String> = definitions[event]?.variables.orEmpty()

    fun kind(event: NotificationEvent): NotificationKind = definitions[event]?.kind ?: NotificationKind.Transactional

    fun channels(event: NotificationEvent): List<NotificationChannel> = definitions[event]?.channels.orEmpty()

    private val PLACEHOLDER = Regex("""\{\{\s*([A-Za-z0-9_]+)\s*\}\}""")

    /** Metindeki `{{ad}}` yer tutucuları — göründükleri sırada, tekrarsız. */
    fun placeholders(text: String): List<String> =
        PLACEHOLDER
            .findAll(text)
            .map { it.groupValues[1] }
            .distinct()
            .toList()

    /** Metinde geçen ama olayda tanımlı olmayan adlar. Boşsa sunucu `TEMPLATE_INVALID` vermez. */
    fun unknownPlaceholders(
        text: String,
        event: NotificationEvent,
    ): List<String> {
        val allowed = variables(event).toSet()
        return placeholders(text).filterNot { it in allowed }
    }
}

/**
 * `NotificationTemplateResponseDto` — liste **birleştirilmiş etkin görünüm**: kiracı satırı
 * olmayan her (olay, kanal) çifti kod varsayılanıyla, `isDefault: true` ve `id: null` gelir.
 * Ekran bu yüzden "sil" değil "kaydedince kiracıya özel olur" der.
 */
@Serializable
data class NotificationTemplate(
    /** Kiracı satırı yoksa `null`. Adı `id` DEĞİL: varsayılan satırlarda boş, kimlik [rowId]. */
    @SerialName("id") val templateId: String? = null,
    val event: NotificationEvent,
    val channel: NotificationChannel,
    val locale: String = DEFAULT_LOCALE,
    val kind: NotificationKind = NotificationKind.Transactional,
    /** Yalnız e-posta kanalında anlamlı; sunucu diğerlerinde anahtarı bile 422 ile reddediyor. */
    val subject: String? = null,
    val body: String = "",
    /** Meta'da onaylı template adı (Ek M: WhatsApp metni bizden gitmiyor). */
    val whatsappTemplateName: String? = null,
    val whatsappTemplateLanguage: String? = null,
    /** `{{1}}, {{2}}…` sırasına karşılık gelen değişkenler — **sıra anlamlı**. */
    val whatsappVariables: List<String> = emptyList(),
    val isActive: Boolean = true,
    val isDefault: Boolean = false,
    val variables: List<String> = emptyList(),
) {
    /** `(event, channel, locale)` — sunucunun upsert anahtarı. */
    val rowId: String get() = "${event.wire}|${channel.wire}|$locale"

    companion object {
        const val DEFAULT_LOCALE = "tr"
    }
}

/** `PUT notification-templates` gövdesi. `null` alanlar gövdeye YAZILMAZ. */
data class NotificationTemplateUpsert(
    val event: NotificationEvent,
    val channel: NotificationChannel,
    val locale: String,
    val subject: String?,
    val body: String,
    val whatsappTemplateName: String?,
    val whatsappTemplateLanguage: String?,
    val whatsappVariables: List<String>?,
    val isActive: Boolean,
)

/**
 * `NotificationPreferenceResponseDto`. `branchId == null` kiracı varsayılanıdır; şube satırı onu
 * ezer. Varsayılan satırların `id`'si boş, liste `(event, branchId)` ile anahtarlanır.
 */
@Serializable
data class NotificationPreference(
    @SerialName("id") val preferenceId: String? = null,
    val branchId: String? = null,
    val event: NotificationEvent,
    val kind: NotificationKind = NotificationKind.Transactional,
    /** Öncelik sırasında denenecek kanallar. **Boş = olay kapalı.** */
    val channels: List<NotificationChannel> = emptyList(),
    /** `"HH:MM"`, şube saat diliminde yorumlanan duvar saati — zaman damgası değil. */
    val quietHoursStart: String? = null,
    val quietHoursEnd: String? = null,
    /**
     * [S] A8.2: sunucu artık türetiyor (`start !== end`). Eski sunucuda alan yok; o zaman
     * aynı kural istemcide uygulanır ([isQuietHoursEnabled]).
     */
    val quietHoursEnabled: Boolean? = null,
    val isDefault: Boolean = false,
) {
    val rowId: String get() = "${event.wire}|${branchId ?: "tenant"}"

    val isEnabled: Boolean get() = channels.isNotEmpty()

    val isQuietHoursEnabled: Boolean
        get() =
            quietHoursEnabled
                ?: (quietHoursStart != null && quietHoursEnd != null && quietHoursStart != quietHoursEnd)

    /** "21:00 – 09:00"; kapalıysa `null`. */
    val quietHoursLabel: String?
        get() {
            val start = ClockTime.parse(quietHoursStart) ?: return null
            val end = ClockTime.parse(quietHoursEnd) ?: return null
            return if (isQuietHoursEnabled) "${start.displayValue} – ${end.displayValue}" else null
        }
}

/**
 * `PUT notification-preferences` gövdesi. Sessiz saatin iki ucu **birlikte** gider (sunucu
 * yalnız birini alınca `VALIDATION_FAILED`); "kapalı" eşit uçlarla (`00:00`–`00:00`) ifade edilir.
 */
data class NotificationPreferenceUpsert(
    val branchId: String?,
    val event: NotificationEvent,
    val channels: List<NotificationChannel>,
    val quietHoursStart: ClockTime,
    val quietHoursEnd: ClockTime,
)

/**
 * `BranchReminderSettingsDto` — **çözülmüş** ayar: şube override'ı yoksa kiracı listesi gelir,
 * hangisi olduğunu [isBranchOverride] söyler.
 */
@Serializable
data class BranchReminderSettings(
    val branchId: String,
    val reminderHoursBefore: List<Int> = emptyList(),
    val isBranchOverride: Boolean = false,
    val noShowFollowupEnabled: Boolean = true,
    val noShowFollowupDelayHours: Int = DEFAULT_FOLLOWUP_DELAY,
) {
    companion object {
        const val DEFAULT_FOLLOWUP_DELAY = 2
        const val MAX_REMINDER_COUNT = 5
        val HOUR_RANGE = 1..720
        val FOLLOWUP_DELAY_RANGE = 0..168
    }
}

/**
 * `PUT branches/:id/reminder-settings` — sunucu kısmi birleştiriyor, `null` alan GÖNDERİLMEZ.
 *
 * ⚠️ `reminderHoursBefore = []` override'ı **kaldırır** ("hiç hatırlatma yok" DEĞİL). Bu yüzden
 * yalnız "Kiracı varsayılanına dön" onu gönderir; taslak hiçbir zaman boş liste üretmez.
 */
data class ReminderSettingsUpdate(
    val reminderHoursBefore: List<Int>? = null,
    val noShowFollowupEnabled: Boolean? = null,
    val noShowFollowupDelayHours: Int? = null,
) {
    val isEmpty: Boolean
        get() = reminderHoursBefore == null && noShowFollowupEnabled == null && noShowFollowupDelayHours == null

    companion object {
        val RESET_TO_TENANT = ReminderSettingsUpdate(reminderHoursBefore = emptyList())
    }
}
