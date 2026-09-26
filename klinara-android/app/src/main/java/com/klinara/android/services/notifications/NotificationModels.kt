package com.klinara.android.services.notifications

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/** İletişim kanalı. */
@Serializable(with = NotificationChannelSerializer::class)
enum class NotificationChannel(val wire: String) {
    WhatsApp("whatsapp"),
    Email("email"),
    Push("push"),
    Unknown("unknown"),
    ;

    val turkishName: String
        get() =
            when (this) {
                WhatsApp -> "WhatsApp"
                Email -> "E-posta"
                Push -> "Anlık bildirim"
                Unknown -> "Bilinmeyen kanal"
            }

    /**
     * Müşteriye gerçekten gönderim yapan tek kanal WhatsApp; e-posta müşteriye kapatıldı. Ekran
     * bunu söylemeli, yoksa kullanıcı kanalı açıp mesajın neden gitmediğini arar. Geçmişte SMS'ten
     * yazılmış günlük satırları [Unknown] olarak çözülür.
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
        val customerSelectable: List<NotificationChannel> = listOf(WhatsApp)

        /** Wire düzeyi küme — sunucunun `ALL_CHANNELS`'ı; personele giden iç e-posta dahil. */
        val all: List<NotificationChannel> = listOf(WhatsApp, Email, Push)
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
