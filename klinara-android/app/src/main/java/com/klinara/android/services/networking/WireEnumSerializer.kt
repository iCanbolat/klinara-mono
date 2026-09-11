package com.klinara.android.services.networking

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * `wire` dizgesiyle kodlanan, tanımadığı değeri `Unknown` koluna düşüren enum serileştiricisi.
 *
 * A8'de doğdu: bildirim alanı dokuz açık enum getiriyor ve her biri için aynı on satırlık
 * `KSerializer` nesnesini yazmak (A0.5–A7 deseni) kopya kod üretirdi. Eski enum'lar kendi
 * nesnelerini koruyor — çalışan kodu yalnız biçim için değiştirmek bir kazanç değil.
 *
 * **Açık küme kuralı:** sunucu yeni bir değer eklediğinde tüm liste çözülemez hâle
 * gelmemeli; [from] bilinmeyeni `Unknown`'a eşler.
 */
internal open class WireEnumSerializer<T : Enum<T>>(
    name: String,
    private val from: (String) -> T,
    private val wire: (T) -> String,
) : KSerializer<T> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor(name, PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): T = from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: T,
    ) = encoder.encodeString(wire(value))
}
