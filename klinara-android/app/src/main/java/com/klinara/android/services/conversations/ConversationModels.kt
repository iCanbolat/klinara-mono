package com.klinara.android.services.conversations

import com.klinara.android.services.networking.InstantSerializer
import com.klinara.android.services.networking.WireEnumSerializer
import com.klinara.android.services.notifications.MessageStatus
import kotlinx.serialization.Serializable
import java.time.Duration
import java.time.Instant

// Kaynak: `apps/api/src/modules/integrations/dto/conversation.dto.ts` ve
// `packages/shared/src/messaging-api.ts`; iOS `ConversationModels.swift` paritesi.
//
// Sohbet bir NUMARAYA bağlı, müşteriye değil: kayıtlı olmayan bir numara da yazabilir
// ve o sohbetin `customer`ı `null` gelir.

/** Sohbetin durumu — açık küme. */
@Serializable(with = ConversationStatusSerializer::class)
enum class ConversationStatus(val wire: String) {
    Open("open"),
    Closed("closed"),
    Unknown("unknown"),
    ;

    companion object {
        fun from(wire: String): ConversationStatus = entries.firstOrNull { it.wire == wire } ?: Unknown
    }
}

internal object ConversationStatusSerializer :
    WireEnumSerializer<ConversationStatus>("ConversationStatus", ConversationStatus::from, { it.wire })

@Serializable
data class ConversationCustomer(
    val id: String,
    val fullName: String,
)

/** `ConversationDto`. */
@Serializable
data class Conversation(
    val id: String,
    /** E.164. */
    val phone: String,
    val customer: ConversationCustomer? = null,
    val status: ConversationStatus,
    @Serializable(with = InstantSerializer::class) val lastMessageAt: Instant,
    val lastMessagePreview: String? = null,
    /** `in` | `out` — listede "Siz: " öneki için. */
    val lastMessageDirection: String? = null,
    val unread: Boolean,
    /** 24 saatlik pencere — kapalıyken serbest metin gönderilemez. */
    val windowOpen: Boolean,
    @Serializable(with = InstantSerializer::class) val windowExpiresAt: Instant? = null,
) {
    val isClosed: Boolean get() = status == ConversationStatus.Closed

    /** Liste ve başlık: müşteri adı, yoksa biçimlenmiş numara. */
    val title: String get() = customer?.fullName ?: ConversationFormat.phone(phone)

    /** Giden bir mesajın ardından satırın yeni hâli. */
    fun afterOutgoing(message: ConversationMessage): Conversation =
        copy(
            lastMessageAt = message.createdAt,
            lastMessagePreview = message.body ?: lastMessagePreview,
            lastMessageDirection = "out",
            unread = false,
        )
}

/** `ConversationMessageDto` — gelen ve giden mesajlar tek akışta. */
@Serializable
data class ConversationMessage(
    val id: String,
    /** `in` | `out`. */
    val direction: String,
    /** Gelen: Meta'nın tipi (`text`, `button`, `image`…). Giden: `text` | `template`. */
    val type: String,
    val body: String? = null,
    @Serializable(with = InstantSerializer::class) val createdAt: Instant,
    /** Yalnız giden. */
    val status: MessageStatus? = null,
    /** Yalnız giden: bildirim olayı (`staff_reply`, `appointment_reminder`…). */
    val event: String? = null,
    val sentByName: String? = null,
    val errorDetail: String? = null,
    val appointmentId: String? = null,
) {
    val isOutgoing: Boolean get() = direction == "out"
    val isTemplate: Boolean get() = type == "template"
    val isFailed: Boolean get() = status == MessageStatus.Failed || status == MessageStatus.Skipped

    /** Balonun üst satırı: kimin/neyin gönderdiği. */
    val senderLabel: String?
        get() {
            if (!isOutgoing) return null
            val eventLabel = event?.let(ConversationFormat::eventLabel)
            if (eventLabel != null) return "Otomatik · $eventLabel"
            val name = sentByName ?: "Otomatik"
            return if (isTemplate) "$name · Şablon" else name
        }

    /** Metin dışı gelen mesajların gövdesi boş olabilir. */
    val displayBody: String get() = body?.takeIf { it.isNotBlank() } ?: ConversationFormat.inboundTypeLabel(type)
}

/** `ConversationDetailDto` — son 200 mesaj, eskiden yeniye. */
@Serializable
data class ConversationDetail(
    val conversation: Conversation,
    val messages: List<ConversationMessage> = emptyList(),
)

/** `ConversationTemplateOptionDto` — pencere kapalıyken gönderilebilecek şablon. */
@Serializable
data class ConversationTemplateOption(
    val name: String,
    val language: String,
    /** Sunucu yalnız işlemsel (`UTILITY`) şablon öneriyor. */
    val category: String,
    /** `{{1}}` yer tutucularıyla gövde. */
    val bodyText: String,
    val bodyVariableCount: Int,
    /** Değişken adları; bilinmiyorsa `null`. */
    val variableNames: List<String?> = emptyList(),
    /** Önerilen değerler; öneri yoksa boş metin. */
    val suggestedParameters: List<String> = emptyList(),
) {
    val key: String get() = "$name|$language"

    /** Alan etiketi: bilinen değişken adı Türkçe, bilinmeyen "n. değişken". */
    fun label(index: Int): String =
        variableNames.getOrNull(index)?.let(ConversationFormat::variableLabel) ?: "${index + 1}. değişken"

    /** `{{n}}` → değer; boş değer yer tutucuyu korur ki eksik alan görünsün. */
    fun render(values: List<String>): String =
        PLACEHOLDER.replace(bodyText) { match ->
            val index = match.groupValues[1].toInt() - 1
            values.getOrNull(index)?.trim()?.takeIf { it.isNotEmpty() } ?: match.value
        }

    fun isComplete(values: List<String>): Boolean = values.size == bodyVariableCount && values.all { it.isNotBlank() }
}

private val PLACEHOLDER = Regex("""\{\{(\d+)\}\}""")

@Serializable
data class UnreadConversationCount(val count: Int)

/** Liste süzgeci — web'deki üç sekmeyle aynı. */
enum class ConversationFilter(val turkishName: String) {
    Open("Açık"),
    Unread("Okunmamış"),
    Closed("Kapalı"),
    ;

    val query: List<Pair<String, String>>
        get() =
            when (this) {
                Open -> listOf("status" to "open")
                Unread -> listOf("status" to "open", "unreadOnly" to "true")
                Closed -> listOf("status" to "closed")
            }

    fun matches(conversation: Conversation): Boolean =
        when (this) {
            Open -> conversation.status == ConversationStatus.Open
            Unread -> conversation.status == ConversationStatus.Open && conversation.unread
            Closed -> conversation.status == ConversationStatus.Closed
        }
}

/** Görünüm metinleri — web'deki `lib/messages/format.ts` karşılığı. */
object ConversationFormat {
    private const val TR_NATIONAL_LENGTH = 10
    private const val MINUTES_PER_HOUR = 60

    /** `5321234567` → `532 123 45 67` grupları — sayılar biçimin kendisi. */
    @Suppress("MagicNumber")
    private val PHONE_GROUPS = listOf(0 until 3, 3 until 6, 6 until 8, 8 until 10)

    /** `+905321234567` → `+90 532 123 45 67`; tanımadığını olduğu gibi bırakır. */
    fun phone(e164: String): String {
        val digits = e164.removePrefix("+90")
        if (!e164.startsWith("+90") || digits.length != TR_NATIONAL_LENGTH || !digits.all(Char::isDigit)) {
            return e164
        }
        return "+90 " + PHONE_GROUPS.joinToString(" ") { digits.substring(it) }
    }

    /** Kalan pencere süresi ("5 sa 12 dk"); kapalıysa `null`. */
    fun windowRemaining(
        conversation: Conversation,
        now: Instant = Instant.now(),
    ): String? {
        val expires = conversation.windowExpiresAt
        if (!conversation.windowOpen || expires == null) return null
        val minutes = Duration.between(now, expires).toMinutes()
        if (minutes <= 0) return null
        val hours = minutes / MINUTES_PER_HOUR
        return if (hours > 0) "$hours sa ${minutes % MINUTES_PER_HOUR} dk" else "$minutes dk"
    }

    fun eventLabel(event: String): String? =
        when (event) {
            "appointment_confirmation" -> "Randevu onayı"
            "appointment_reminder" -> "Randevu hatırlatması"
            "appointment_cancelled" -> "İptal bildirimi"
            "no_show_followup" -> "Gelmedi takibi"
            "package_balance" -> "Paket bakiyesi"
            "package_expiring" -> "Paket süresi"
            "auto_reply" -> "Otomatik cevap"
            else -> null
        }

    fun inboundTypeLabel(type: String): String =
        when (type) {
            "image" -> "Fotoğraf gönderdi"
            "audio" -> "Sesli mesaj gönderdi"
            "video" -> "Video gönderdi"
            "document" -> "Belge gönderdi"
            "location" -> "Konum gönderdi"
            "sticker" -> "Çıkartma gönderdi"
            "button" -> "Butonla yanıtladı"
            else -> "Desteklenmeyen mesaj — telefondan görüntüleyin"
        }

    fun variableLabel(name: String): String? =
        when (name) {
            "customerName" -> "Müşteri adı"
            "branchName" -> "Şube / klinik adı"
            "appointmentAt" -> "Randevu zamanı"
            "serviceName" -> "Hizmet"
            "packageName" -> "Paket"
            "remainingSessions" -> "Kalan seans"
            "expiresAt" -> "Bitiş tarihi"
            else -> null
        }
}
