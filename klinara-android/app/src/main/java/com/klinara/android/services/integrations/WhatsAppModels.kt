package com.klinara.android.services.integrations

import com.klinara.android.services.networking.InstantSerializer
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
