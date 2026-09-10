package com.klinara.android.services.crm

import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant

/**
 * Not türü.
 *
 * [Treatment] ve [Internal] **sağlık verisidir** (KVKK m.6) ve `customer.medical:read`
 * izni olmayana sunucu tarafından **sorgudan hiç döndürülmez** — yanıtta "gizlendi"
 * diye bir bayrak da yoktur.
 *
 * Bu sessizliği istemci kırmak zorunda: boş bir "Tedavi" listesi göstermek,
 * resepsiyona *"bu müşterinin tedavi notu yok"* demektir ve bu **yanlış bilgidir**.
 */
@Serializable(with = CustomerNoteKindSerializer::class)
enum class CustomerNoteKind(val wire: String) {
    General("general"),
    Treatment("treatment"),
    Internal("internal"),
    Unknown("unknown"),
    ;

    val turkishName: String
        get() =
            when (this) {
                General -> "Genel"
                Treatment -> "Tedavi"
                Internal -> "İç not"
                Unknown -> "Bilinmeyen tür"
            }

    /** Sağlık verisi mi? `customer.medical:*` kapısı bunun üstünden çalışır. */
    val isClinical: Boolean get() = this == Treatment || this == Internal

    companion object {
        fun from(wire: String): CustomerNoteKind = entries.firstOrNull { it.wire == wire } ?: Unknown

        /** Kullanıcının seçebileceği türler — [Unknown] bir seçenek değil, kurtarma dalı. */
        val selectable: List<CustomerNoteKind> = listOf(General, Treatment, Internal)
    }
}

internal object CustomerNoteKindSerializer : KSerializer<CustomerNoteKind> {
    override val descriptor = PrimitiveSerialDescriptor("CustomerNoteKind", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): CustomerNoteKind = CustomerNoteKind.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: CustomerNoteKind,
    ) = encoder.encodeString(value.wire)
}

/**
 * Müşteri notu.
 *
 * [version] iyimser kilit token'ıdır: `PATCH notes/:id` `If-Match: W/"<version>"`
 * **ZORUNLU** tutar — başlıksız istek `428`, bayat sürüm `409 VERSION_CONFLICT`.
 *
 * ⚠️ **Sürümü YALNIZ METİN değişimi artırır** (`customer_notes_revision` trigger'ı
 * `new.body is distinct from old.body` koşuluyla çalışıyor). [kind] ya da
 * [customerVisible] değiştiren bir düzenleme sürümü olduğu yerde bırakır ve elde
 * tutulan ETag geçerli kalır. Bu bir kaçak değil: bayrak değişimi kaybolan bir cümle
 * üretmiyor.
 */
@Serializable
data class CustomerNote(
    val id: String,
    val customerId: String,
    val appointmentId: String? = null,
    val kind: CustomerNoteKind = CustomerNoteKind.General,
    val body: String,
    val customerVisible: Boolean = false,
    val authorUserId: String? = null,
    val version: Int = 1,
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
    @Serializable(with = InstantSerializer::class)
    val updatedAt: Instant? = null,
) {
    /** Sürüm 1'den büyükse metin en az bir kez düzenlenmiş demektir. */
    val wasEdited: Boolean get() = version > 1
}

/**
 * Bir düzenlemenin bıraktığı iz.
 *
 * ⚠️ [body] **düzenlemeden ÖNCEKİ** metindir, sonraki değil. Trigger eski gövdeyi
 * saklıyor; ekranda "şu an" ile "önce" karışırsa kullanıcı yanlış metni geri alır.
 */
@Serializable
data class CustomerNoteRevision(
    val id: String,
    val body: String,
    val version: Int,
    val editedBy: String? = null,
    @Serializable(with = InstantSerializer::class)
    val editedAt: Instant? = null,
)
