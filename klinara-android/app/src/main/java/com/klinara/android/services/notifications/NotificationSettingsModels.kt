package com.klinara.android.services.notifications

import com.klinara.android.services.formatting.ClockTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Kaynak: `apps/api/src/modules/notifications/dto/notification.dto.ts`, `reminder.dto.ts` ve
// `default-templates.ts`; iOS `NotificationModels.swift` / `ReminderModels.swift` paritesi.

/**
 * Olay → varsayılan kanal önceliği ve izinli değişkenler; `default-templates.ts`'in aynası.
 *
 * İstemcide durmasının tek sebebi bir kullanıcı deneyimi kararı: şablon editörü `{{…}}` yer
 * tutucularını **yazarken** doğrulayabilsin. Sunucu yine son söz sahibi (`TEMPLATE_INVALID`);
 * bu tablo bir kolaylık, bir yetki değil.
 */
object NotificationEventCatalog {
    data class Definition(
        val channels: List<NotificationChannel>,
        val variables: List<String>,
    )

    // Müşteriye e-posta GİTMEZ: klinik müşterisiyle yalnız WhatsApp üzerinden yazışır.
    // `StaffInternal` bir istisna değil, farklı bir alıcı — personele giden iç bildirim.
    private val whatsapp = listOf(NotificationChannel.WhatsApp)
    private val appointmentVariables =
        listOf("customerName", "branchName", "branchAddress", "appointmentAt", "serviceName")

    val definitions: Map<NotificationEvent, Definition> =
        mapOf(
            NotificationEvent.AppointmentConfirmation to
                Definition(whatsapp, appointmentVariables),
            NotificationEvent.AppointmentReminder to
                Definition(whatsapp, appointmentVariables),
            NotificationEvent.AppointmentCancelled to
                Definition(
                    whatsapp,
                    listOf("customerName", "branchName", "appointmentAt"),
                ),
            NotificationEvent.NoShowFollowup to
                Definition(whatsapp, listOf("customerName", "branchName")),
            NotificationEvent.PackageBalance to
                Definition(
                    whatsapp,
                    listOf("customerName", "packageName", "remainingSessions"),
                ),
            NotificationEvent.PackageExpiring to
                Definition(
                    whatsapp,
                    listOf("customerName", "packageName", "expiresAt", "remainingSessions"),
                ),
            NotificationEvent.AutoReply to
                Definition(whatsapp, listOf("message")),
            NotificationEvent.StaffInternal to
                Definition(
                    listOf(NotificationChannel.Email),
                    listOf("subject", "message"),
                ),
        )

    fun variables(event: NotificationEvent): List<String> = definitions[event]?.variables.orEmpty()

    fun channels(event: NotificationEvent): List<NotificationChannel> = definitions[event]?.channels.orEmpty()

    /**
     * Ekranda görünen `@Etiket`ler; teknik `{{customerName}}` biçimi arayüzde geçmez.
     * Sunucudaki `packages/shared/src/notification-templates.ts` ile aynı tablo: canlıda parçalar
     * sunucudan gelir, bu tablo yalnız mock'un ve `segments` göndermeyen eski bir sunucunun yedeğidir.
     */
    private val variableHandles =
        mapOf(
            "customerName" to "@MüşteriAdı",
            "branchName" to "@KlinikAdı",
            "branchAddress" to "@KlinikAdresi",
            "appointmentAt" to "@RandevuZamanı",
            "serviceName" to "@HizmetAdı",
            "packageName" to "@PaketAdı",
            "remainingSessions" to "@KalanSeans",
            "expiresAt" to "@SonKullanımTarihi",
            "message" to "@Mesaj",
            "subject" to "@Konu",
        )

    /** Tanımsız ad ham haliyle (`@ad`) görünür — sessizce yutulmaz. */
    fun handle(variable: String): String = variableHandles[variable] ?: "@$variable"

    /** `Sayın {{customerName}}` → `[metin "Sayın ", değişken @MüşteriAdı]`. */
    fun segments(text: String): List<TemplateSegment> {
        val result = mutableListOf<TemplateSegment>()
        var cursor = 0
        for (match in PLACEHOLDER.findAll(text)) {
            if (match.range.first > cursor) result += TemplateSegment.text(text.substring(cursor, match.range.first))
            val name = match.groupValues[1]
            result += TemplateSegment.variable(name, handle(name))
            cursor = match.range.last + 1
        }
        if (cursor < text.length) result += TemplateSegment.text(text.substring(cursor))
        return result
    }

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
 * Şablon gövdesinin bir parçası: düz metin ya da `@HizmetAdı` gibi bir değişken.
 *
 * Ekranlar `{{…}}` ayrıştırmaz; sunucunun verdiği parçaları sırayla çizer. Değişken mavi bağlantı
 * renginde görünür — yazılabilir bir metin değil, gönderim anında doldurulan tipli bir alandır.
 * Düz veri sınıfı: bilinmeyen bir `kind` çökmez, düz metin sayılır.
 */
@Serializable
data class TemplateSegment(
    val kind: String = KIND_TEXT,
    val text: String = "",
    val name: String = "",
    val handle: String = "",
) {
    val isVariable: Boolean get() = kind == KIND_VARIABLE

    /** Ekranda görünen yazı: değişkenlerde `@Etiket`, metinde kendisi. */
    val display: String get() = if (isVariable) handle.ifEmpty { "@$name" } else text

    companion object {
        const val KIND_TEXT = "text"
        const val KIND_VARIABLE = "variable"

        fun text(value: String) = TemplateSegment(kind = KIND_TEXT, text = value)

        fun variable(
            name: String,
            handle: String,
        ) = TemplateSegment(kind = KIND_VARIABLE, name = name, handle = handle)
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
    /** Sunucunun parçaladığı gövde; eski bir sunucu göndermezse `null`. Ekranlar [displaySegments]i okur. */
    val segments: List<TemplateSegment>? = null,
) {
    /** Ekranın çizdiği gövde: `@Etiket`li parçalar. */
    val displaySegments: List<TemplateSegment> get() = segments ?: NotificationEventCatalog.segments(body)

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
