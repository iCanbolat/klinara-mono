package com.klinara.android.services.notifications

import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant

/** İletişim kanalı. */
@Serializable(with = NotificationChannelSerializer::class)
enum class NotificationChannel(val wire: String) {
    WhatsApp("whatsapp"),
    Sms("sms"),
    Email("email"),
    Push("push"),
    Unknown("unknown"),
    ;

    val turkishName: String
        get() =
            when (this) {
                WhatsApp -> "WhatsApp"
                Sms -> "SMS"
                Email -> "E-posta"
                Push -> "Anlık bildirim"
                Unknown -> "Bilinmeyen kanal"
            }

    /**
     * Müşteriye gerçekten gönderim yapan tek kanal WhatsApp. SMS kanal soyutlamasında var ama
     * sağlayıcısı yok (Ek M); e-posta müşteriye kapatıldı. Ekran bunu söylemeli, yoksa kullanıcı
     * kanalı açıp mesajın neden gitmediğini arar.
     */
    val isDeliverable: Boolean get() = this == WhatsApp

    companion object {
        fun from(wire: String): NotificationChannel = entries.firstOrNull { it.wire == wire } ?: Unknown

        /**
         * Müşteriye gidebilecek kanallar — sunucunun `CUSTOMER_CHANNELS`'ı.
         *
         * `Email` ve `Push` dışarıda: birincisi ürün kararı (klinik müşterisiyle yalnız WhatsApp
         * yazışır), ikincisinin sağlayıcısı yok. Enum'da ikisi de DURUYOR: mesaj günlüğü geçmişte
         * gerçekten gönderilmiş e-posta satırlarını çözebilmeli.
         */
        val customerSelectable: List<NotificationChannel> = listOf(WhatsApp, Sms)

        /** Wire düzeyi küme — sunucunun `ALL_CHANNELS`'ı; personele giden iç e-posta dahil. */
        val all: List<NotificationChannel> = listOf(WhatsApp, Sms, Email, Push)
    }
}

internal object NotificationChannelSerializer : KSerializer<NotificationChannel> {
    override val descriptor = PrimitiveSerialDescriptor("NotificationChannel", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): NotificationChannel = NotificationChannel.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: NotificationChannel,
    ) = encoder.encodeString(value.wire)
}

/** İleti reddinin kaynağı — kim kapattı. */
@Serializable(with = OptOutSourceSerializer::class)
enum class OptOutSource(val wire: String) {
    CustomerRequest("customer_request"),
    InboundStop("inbound_stop"),
    Staff("staff"),
    Unknown("unknown"),
    ;

    val turkishName: String
        get() =
            when (this) {
                CustomerRequest -> "Müşteri talebi"
                InboundStop -> "Gelen STOP mesajı"
                Staff -> "Personel"
                Unknown -> "Bilinmeyen"
            }

    companion object {
        fun from(wire: String): OptOutSource = entries.firstOrNull { it.wire == wire } ?: Unknown

        val selectable: List<OptOutSource> = listOf(CustomerRequest, InboundStop, Staff)
    }
}

internal object OptOutSourceSerializer : KSerializer<OptOutSource> {
    override val descriptor = PrimitiveSerialDescriptor("OptOutSource", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): OptOutSource = OptOutSource.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: OptOutSource,
    ) = encoder.encodeString(value.wire)
}

/**
 * Bir ileti reddi kaydı.
 *
 * ⚠️ [channel] `null` ise **TÜM kanallar** kapalı demektir — "kanal bilinmiyor" değil.
 * Bu ayrım ekranda açıkça yazılıyor.
 *
 * [kind] her zaman `marketing`: **işlemsel iletiler bu kayıttan etkilenmez.** Randevu
 * hatırlatması bir ticari ileti değildir ve rıza geri alınsa da gider — ekran bunu
 * söylemek zorunda, yoksa personel "müşteriye hiçbir şey gitmeyecek" sanır.
 */
@Serializable
data class OptOutRecord(
    val id: String,
    val customerId: String,
    val channel: NotificationChannel? = null,
    val kind: String? = null,
    val source: OptOutSource? = null,
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
) {
    val channelLabel: String get() = channel?.turkishName ?: "Tüm kanallar"
}
