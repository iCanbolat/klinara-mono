package com.klinara.android.services.notifications

import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.InstantSerializer
import com.klinara.android.services.networking.ProblemDetails
import com.klinara.android.services.networking.WireEnumSerializer
import kotlinx.serialization.Serializable
import java.time.Instant

// Kaynak: `apps/api/src/modules/notifications/dto/notification.dto.ts` ve `reminder.dto.ts`;
// iOS `MessageModels.swift`, `ReminderModels.swift`, `NotificationModels.swift` paritesi.
//
// Ek M kararı ekranı doğrudan biçimlendiriyor: ham adres saklanmıyor (`to` maskeli gelir) ve
// engellenen mesaj atılmıyor, `skipped` yazılıyor. Mesaj günlüğü "ne gitti" değil "ne oldu"
// defteridir; `skipped` satırları gizlenmez.

/**
 * Bildirim olayı — **açık** küme: sunucu yeni bir olay tanımladığında eski bir istemci mesaj
 * günlüğünü çözemeyip patlamamalı.
 */
@Serializable(with = NotificationEventSerializer::class)
enum class NotificationEvent(
    val wire: String,
    val turkishName: String,
    val explanation: String,
) {
    AppointmentConfirmation(
        "appointment_confirmation",
        "Randevu onayı",
        "Randevu oluşturulduğunda müşteriye gider.",
    ),
    AppointmentReminder(
        "appointment_reminder",
        "Randevu hatırlatması",
        "Randevudan önce, hatırlatma ayarındaki saatlerde gider.",
    ),
    AppointmentCancelled(
        "appointment_cancelled",
        "Randevu iptali",
        "Randevu iptal edildiğinde müşteriye gider.",
    ),
    NoShowFollowup(
        "no_show_followup",
        "Gelmedi takibi",
        "Müşteri gelmediğinde, ayarlanan gecikmeden sonra gider.",
    ),
    PackageBalance("package_balance", "Paket bakiyesi", "Paket hakkı azaldığında müşteriye gider."),
    PackageExpiring("package_expiring", "Paket süre dolumu", "Paketin süresi dolmadan önce müşteriye gider."),
    Birthday(
        "birthday",
        "Doğum günü",
        "Doğum gününde gider. Tek pazarlama olayı: iletişim izni iptalinden etkilenir.",
    ),
    AutoReply("auto_reply", "Otomatik yanıt", "Müşterinin WhatsApp yanıtına verilen otomatik karşılık."),
    StaffInternal("staff_internal", "Personel bildirimi", "Müşteriye değil, personele giden iç bildirim."),
    Unknown("unknown", "Bilinmeyen olay", "Bu sürümde tanınmayan bir olay. Uygulamayı güncelleyin."),
    ;

    companion object {
        fun from(wire: String): NotificationEvent = entries.firstOrNull { it.wire == wire } ?: Unknown

        /** Seçim listelerinde `Unknown` gösterilmez — kullanıcı onu üretemez. */
        val selectable: List<NotificationEvent> = entries.filter { it != Unknown }
    }
}

internal object NotificationEventSerializer :
    WireEnumSerializer<NotificationEvent>("NotificationEvent", NotificationEvent::from, { it.wire })

/**
 * İşlemsel / pazarlama ayrımı — olayın TANIMINDA, kiracı ayarında değil.
 *
 * iOS'ta kapalı küme; burada `Unknown` kolu var (A4.2'deki `NotificationChannel` gerekçesi):
 * sunucunun ekleyeceği tek bir tür bütün şablon listesini çözülemez hâle getirmemeli.
 */
@Serializable(with = NotificationKindSerializer::class)
enum class NotificationKind(
    val wire: String,
    val turkishName: String,
    val explanation: String,
    val badgeTone: KlinaraBadgeTone,
) {
    Transactional(
        "transactional",
        "İşlemsel",
        "Müşterinin kendi işlemiyle ilgili; iletişim izni iptalinden etkilenmez.",
        KlinaraBadgeTone.Neutral,
    ),
    Marketing(
        "marketing",
        "Pazarlama",
        "Ticari ileti; iletişim izni iptal edilmişse gönderilmez.",
        KlinaraBadgeTone.Warning,
    ),
    Unknown("unknown", "Bilinmeyen tür", "Bu sürümde tanınmayan bir tür.", KlinaraBadgeTone.Muted),
    ;

    companion object {
        fun from(wire: String): NotificationKind = entries.firstOrNull { it.wire == wire } ?: Unknown
    }
}

internal object NotificationKindSerializer :
    WireEnumSerializer<NotificationKind>("NotificationKind", NotificationKind::from, { it.wire })

/** Gönderim durumu — açık küme (sunucu ileride `expired` gibi bir durum ekleyebilir). */
@Serializable(with = MessageStatusSerializer::class)
enum class MessageStatus(
    val wire: String,
    val turkishName: String,
    val explanation: String,
    val badgeTone: KlinaraBadgeTone,
) {
    Queued(
        "queued",
        "Kuyrukta",
        "Sırada bekliyor. Sessiz saatte üretilen mesaj sabaha ertelenir.",
        KlinaraBadgeTone.Neutral,
    ),
    Sending("sending", "Gönderiliyor", "Sağlayıcıya iletiliyor.", KlinaraBadgeTone.Neutral),
    Sent("sent", "Gönderildi", "Sağlayıcı kabul etti.", KlinaraBadgeTone.Positive),
    Delivered("delivered", "Ulaştı", "Müşterinin cihazına ulaştı.", KlinaraBadgeTone.Positive),
    Read("read", "Okundu", "Müşteri okudu.", KlinaraBadgeTone.Positive),
    Failed("failed", "Başarısız", "Gönderilemedi. Sebebi aşağıda.", KlinaraBadgeTone.Warning),
    Skipped(
        "skipped",
        "Gönderilmedi",
        "Üretildi ama gönderilmedi — iletişim izni kapalı ya da kanal yapılandırılmamış.",
        KlinaraBadgeTone.Muted,
    ),
    Unknown(
        "unknown",
        "Bilinmiyor",
        "Bu sürümde tanınmayan bir durum. Uygulamayı güncelleyin.",
        KlinaraBadgeTone.Muted,
    ),
    ;

    companion object {
        fun from(wire: String): MessageStatus = entries.firstOrNull { it.wire == wire } ?: Unknown
    }
}

internal object MessageStatusSerializer :
    WireEnumSerializer<MessageStatus>("MessageStatus", MessageStatus::from, { it.wire })

/** `MessageResponseDto`. */
@Serializable
data class Message(
    val id: String,
    val customerId: String? = null,
    val userId: String? = null,
    val channel: NotificationChannel,
    val event: NotificationEvent,
    val status: MessageStatus,
    /** **Maskeli** adres (`+90**********67`). Ham adres sunucuda da saklanmıyor. */
    val to: String,
    val subject: String? = null,
    val body: String? = null,
    /** `packages/shared/src/error-codes.ts` değeri. */
    val errorCode: String? = null,
    val attempt: Int = 0,
    @Serializable(with = InstantSerializer::class) val scheduledFor: Instant,
    @Serializable(with = InstantSerializer::class) val sentAt: Instant? = null,
    @Serializable(with = InstantSerializer::class) val deliveredAt: Instant? = null,
    @Serializable(with = InstantSerializer::class) val createdAt: Instant,
) {
    /**
     * Başarısız satırda sebebi kullanıcı diliyle söyleyebilmek için — `ApiError`'ın metin
     * tablosundan. **Bilinmeyen kod ham hâliyle** gösterilir: saklamak destek kaydını yok ederdi.
     */
    val failureMessage: String?
        get() {
            val raw = errorCode ?: return null
            val code = ApiErrorCode.from(raw)
            if (code == ApiErrorCode.UNKNOWN) return raw
            // `detail` boş: TEMPLATE_INVALID gibi `detail`'e yaslanan kodlar tablo metnine düşsün.
            return ApiError.Problem(ProblemDetails(code = code, title = raw, status = 0)).displayMessage
        }

    /** `attempt == 0` ile `failed` birlikteyse sorun gönderimde değil ÜRETİMDE. */
    val wasAttempted: Boolean get() = attempt > 0
}

/**
 * `GET /messages` süzgeci — sorgu parametreleriyle birebir; `null` "süzme" demek.
 * [from]/[to] `createdAt` üzerinde.
 */
data class MessageFilter(
    val customerId: String? = null,
    val channel: NotificationChannel? = null,
    val event: NotificationEvent? = null,
    val status: MessageStatus? = null,
    val from: Instant? = null,
    val to: Instant? = null,
) {
    val isActive: Boolean get() = this != NONE

    companion object {
        val NONE = MessageFilter()
    }
}

/** Bildirim planı satırının durumu. */
@Serializable(with = ScheduledNotificationStatusSerializer::class)
enum class ScheduledNotificationStatus(
    val wire: String,
    val turkishName: String,
    val badgeTone: KlinaraBadgeTone,
) {
    Pending("pending", "Planlandı", KlinaraBadgeTone.Neutral),
    Sent("sent", "Gönderildi", KlinaraBadgeTone.Positive),
    Cancelled("cancelled", "İptal edildi", KlinaraBadgeTone.Muted),
    Superseded("superseded", "Yenisiyle değişti", KlinaraBadgeTone.Muted),
    Unknown("unknown", "Bilinmiyor", KlinaraBadgeTone.Muted),
    ;

    companion object {
        fun from(wire: String): ScheduledNotificationStatus = entries.firstOrNull { it.wire == wire } ?: Unknown
    }
}

internal object ScheduledNotificationStatusSerializer :
    WireEnumSerializer<ScheduledNotificationStatus>(
        "ScheduledNotificationStatus",
        ScheduledNotificationStatus::from,
        { it.wire },
    )

/**
 * `ScheduledNotificationDto` — bir randevunun bildirim çizelgesi.
 *
 * `cancelled` ve `superseded` satırlar da gelir (Ek M): "randevu ertelendi, eski hatırlatma
 * ne oldu" sorusunun cevabı tam da o satırlarda.
 */
@Serializable
data class ScheduledNotification(
    val id: String,
    val event: NotificationEvent,
    /** Randevudan kaç saat **önce**. Gelmedi takibinde negatif: randevudan sonra. */
    val offsetHours: Int,
    @Serializable(with = InstantSerializer::class) val scheduledFor: Instant,
    val status: ScheduledNotificationStatus,
    val messageId: String? = null,
) {
    val isFollowup: Boolean get() = offsetHours < 0

    val offsetLabel: String
        get() =
            if (isFollowup) {
                "Randevudan ${-offsetHours} saat sonra"
            } else {
                "Randevudan $offsetHours saat önce"
            }
}
