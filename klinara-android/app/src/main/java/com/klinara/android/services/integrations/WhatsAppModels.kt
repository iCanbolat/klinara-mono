package com.klinara.android.services.integrations

import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.services.networking.InstantSerializer
import com.klinara.android.services.networking.WireEnumSerializer
import kotlinx.serialization.Serializable
import java.time.Instant

// Kaynak: `apps/api/src/modules/integrations/dto/whatsapp.dto.ts`, `webhook.dto.ts`;
// iOS `WhatsAppModels.swift` paritesi.

/**
 * `InboxItemDto` — müşterinin WhatsApp'tan yazdığı serbest metin.
 *
 * Buton yanıtları (Onayla / İptal Et) buraya düşmez; sunucu onları doğrudan randevu
 * durumuna çeviriyor. Burada duran, personelin **okuması gereken** mesajdır.
 */
@Serializable
data class InboxItem(
    val id: String,
    /** Numara kayıtlı bir müşteriyle eşleşmediyse `null` — sunucu bilerek tahmin etmiyor. */
    val customerId: String? = null,
    /** Maskeli gönderen numarası. */
    val from: String,
    /** Meta'nın `message.type` alanının **serbest** geçişi — enum değil. */
    val messageType: String,
    val body: String? = null,
    @Serializable(with = InstantSerializer::class) val receivedAt: Instant,
    /** `null` = henüz işlenmedi. Gelen kutusunda ayrı bir "durum" enum'u yok. */
    @Serializable(with = InstantSerializer::class) val handledAt: Instant? = null,
) {
    val isHandled: Boolean get() = handledAt != null

    val messageTypeLabel: String
        get() =
            when (messageType) {
                "text" -> "Metin"
                "button" -> "Buton yanıtı"
                "interactive" -> "Etkileşimli yanıt"
                "image" -> "Görsel"
                "audio" -> "Ses"
                "document" -> "Belge"
                else -> messageType
            }

    /** Metin dışındaki türlerde gövde boş gelebilir; listede boş satır çizilmesin. */
    val preview: String get() = body?.takeIf { it.isNotBlank() } ?: "($messageTypeLabel)"
}

/** Hesabın bağlantı durumu — açık küme. */
@Serializable(with = WhatsAppAccountStatusSerializer::class)
enum class WhatsAppAccountStatus(
    val wire: String,
    val turkishName: String,
    val badgeTone: KlinaraBadgeTone,
) {
    Unconfigured("unconfigured", "Yapılandırılmadı", KlinaraBadgeTone.Muted),
    Active("active", "Bağlı", KlinaraBadgeTone.Positive),
    Error("error", "Hata", KlinaraBadgeTone.Warning),
    Unknown("unknown", "Bilinmiyor", KlinaraBadgeTone.Muted),
    ;

    companion object {
        fun from(wire: String): WhatsAppAccountStatus = entries.firstOrNull { it.wire == wire } ?: Unknown
    }
}

internal object WhatsAppAccountStatusSerializer :
    WireEnumSerializer<WhatsAppAccountStatus>("WhatsAppAccountStatus", WhatsAppAccountStatus::from, { it.wire })

/** Meta template onay durumu — sunucu küçük harf yazıyor. */
@Serializable(with = WhatsAppTemplateStatusSerializer::class)
enum class WhatsAppTemplateStatus(
    val wire: String,
    val turkishName: String,
    val badgeTone: KlinaraBadgeTone,
) {
    Pending("pending", "Onay bekliyor", KlinaraBadgeTone.Muted),
    Approved("approved", "Onaylı", KlinaraBadgeTone.Positive),
    Rejected("rejected", "Reddedildi", KlinaraBadgeTone.Warning),
    Unknown("unknown", "Bilinmiyor", KlinaraBadgeTone.Muted),
    ;

    companion object {
        fun from(wire: String): WhatsAppTemplateStatus = entries.firstOrNull { it.wire == wire } ?: Unknown
    }
}

internal object WhatsAppTemplateStatusSerializer :
    WireEnumSerializer<WhatsAppTemplateStatus>("WhatsAppTemplateStatus", WhatsAppTemplateStatus::from, { it.wire })

/**
 * `WhatsAppAccountResponseDto`. **Ham token hiçbir yanıtta yok** — yalnız maskeli hâli; hesap
 * (okunur) ve [WhatsAppAccountUpsert] (yazılır) bu yüzden AYRI tipler.
 */
@Serializable
data class WhatsAppAccount(
    val wabaId: String,
    val phoneNumberId: String,
    val businessPhone: String? = null,
    val apiVersion: String,
    val status: WhatsAppAccountStatus = WhatsAppAccountStatus.Unknown,
    /** `••••••••` + son dört karakter. */
    val accessTokenMasked: String,
    /** App secret'ın VARLIĞI; değeri değil. Webhook imzası bununla doğrulanıyor. */
    val hasAppSecret: Boolean = false,
    @Serializable(with = InstantSerializer::class) val lastVerifiedAt: Instant? = null,
    val lastError: String? = null,
)

/**
 * `PUT integrations/whatsapp` gövdesi. [accessToken] **zorunlu** (sunucu kısmi güncelleme
 * kabul etmiyor, kayıtlı token okunamıyor). [appSecret] `null` ise gönderilmez ve — [S] A8.3
 * düzeltmesinden sonra — kayıtlı değer korunur.
 */
data class WhatsAppAccountUpsert(
    val wabaId: String,
    val phoneNumberId: String,
    val businessPhone: String?,
    val accessToken: String,
    val appSecret: String?,
    val apiVersion: String?,
) {
    companion object {
        val ACCESS_TOKEN_LENGTH = 10..500
        val APP_SECRET_LENGTH = 8..200
        const val MIN_ID_LENGTH = 3
        const val DEFAULT_API_VERSION = "v21.0"
        val API_VERSION = Regex("""v\d+\.\d+""")
    }
}

/** `POST integrations/whatsapp/verify` — başarısızlık `ok: false` ile döner, hata FIRLATMAZ. */
@Serializable
data class WhatsAppVerifyResult(
    val ok: Boolean,
    val error: String? = null,
    val templateCount: Int = 0,
)

@Serializable
data class WhatsAppTemplateButton(
    val type: String,
    val text: String,
)

/** `WhatsAppTemplateResponseDto` — Meta'dan senkronlanan template'ler. */
@Serializable
data class WhatsAppTemplate(
    val name: String,
    val language: String,
    val category: String? = null,
    val status: WhatsAppTemplateStatus = WhatsAppTemplateStatus.Unknown,
    val bodyVariableCount: Int = 0,
    val buttons: List<WhatsAppTemplateButton> = emptyList(),
    @Serializable(with = InstantSerializer::class) val syncedAt: Instant? = null,
) {
    /** Aynı ad iki dilde olabilir — kimlik ad + dil (iOS test ekranı yalnız ada bakıyordu). */
    val rowId: String get() = "$name|$language"

    /** Test gönderimi sunucuda **sıfır parametreyle**: değişken bekleyen şablon Meta'da reddedilir. */
    val isTestable: Boolean get() = status == WhatsAppTemplateStatus.Approved && bodyVariableCount == 0
}

/** `POST integrations/whatsapp/test` gövdesi. */
data class WhatsAppTestSend(
    val to: String,
    val templateName: String,
    val templateLanguage: String,
)

@Serializable
data class WhatsAppTestResult(
    val accepted: Boolean,
    val providerMessageId: String? = null,
)
