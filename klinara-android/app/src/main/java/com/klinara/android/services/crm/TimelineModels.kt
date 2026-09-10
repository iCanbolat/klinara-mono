package com.klinara.android.services.crm

import com.klinara.android.services.networking.InstantSerializer
import com.klinara.android.services.networking.KlinaraJson
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant

/**
 * Zaman çizelgesindeki bir olayın türü.
 *
 * **[Unknown] kolu ZORUNLUDUR ve bir konfor değil, bir hayatta kalma şartıdır.**
 * Faz 5, 6 ve 7 bu akışa kendi kolunu ekleyecek; bilinmeyen bir `kind` çözümlemeyi
 * patlatsaydı **eski istemci yeni sunucuda müşteri kartını HİÇ açamazdı** — tek bir
 * yeni olay türü, tüm kartı kilitlerdi.
 *
 * Olay yutulmuyor da: ekranda "bu sürümde gösterilemeyen kayıt" olarak çiziliyor ki
 * eksik bir geçmiş, tam bir geçmiş gibi görünmesin.
 */
@Serializable(with = TimelineKindSerializer::class)
enum class TimelineKind(val wire: String) {
    Appointment("appointment"),
    Note("note"),
    Consent("consent"),
    PackageSale("package_sale"),
    PackageLedger("package_ledger"),
    Unknown("unknown"),
    ;

    val turkishName: String
        get() =
            when (this) {
                Appointment -> "Randevu"
                Note -> "Not"
                Consent -> "Onam"
                PackageSale -> "Paket satışı"
                PackageLedger -> "Paket hareketi"
                Unknown -> "Diğer"
            }

    companion object {
        fun from(wire: String): TimelineKind = entries.firstOrNull { it.wire == wire } ?: Unknown

        /** Filtrede gösterilebilecek türler. */
        val selectable: List<TimelineKind> = entries.filter { it != Unknown }
    }
}

internal object TimelineKindSerializer : KSerializer<TimelineKind> {
    override val descriptor = PrimitiveSerialDescriptor("TimelineKind", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): TimelineKind = TimelineKind.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: TimelineKind,
    ) = encoder.encodeString(value.wire)
}

/**
 * Zaman çizelgesi girdisi.
 *
 * [payload] **çözümlenmemiş** bir `JsonObject` olarak duruyor ve bu bilinçli: türe göre
 * beş farklı şekil taşıyor, hepsini sealed bir hiyerarşiye açmak bugün okunmayan
 * alanları modellemek olurdu (A3.3'ün `Customer`ı kırpık bırakma gerekçesinin aynısı).
 * Ekranın ihtiyacı olan üç-dört alan [string] / [instant] ile okunuyor; Faz 5/6 kendi
 * kolunu eklerken buraya dokunmadan alan ekleyebilir.
 *
 * ⚠️ [occurredAt] **`+00:00` offset'iyle** geliyor, takvim uçlarındaki şube
 * offset'iyle (`+03:00`) değil — `jsonb_build_object` `timestamptz`yi oturum saat
 * diliminde serileştiriyor. İkisi **aynı anı** gösteriyor ve `InstantSerializer` her
 * ikisini de çözüyor; ama varsayım yanlış olsaydı bir gün "saatler 3 saat kaymış"
 * olarak keşfedilirdi (iOS'ta yakalanan hata #3).
 */
@Serializable
data class TimelineEntry(
    val kind: TimelineKind = TimelineKind.Unknown,
    val id: String,
    @Serializable(with = InstantSerializer::class)
    val occurredAt: Instant? = null,
    val payload: JsonObject = JsonObject(emptyMap()),
) {
    /** Payload'dan bir metin alanı; yoksa null. Eksik alan çökme sebebi değildir. */
    fun string(key: String): String? =
        payload[key]
            ?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }
            ?.takeIf { it.isNotBlank() && it != "null" }

    fun long(key: String): Long? = string(key)?.toLongOrNull()

    fun instant(key: String): Instant? =
        string(key)?.let { raw ->
            runCatching { KlinaraJson.decodeFromString(InstantSerializer, "\"$raw\"") }.getOrNull()
        }

    /**
     * Satır başlığı — türe göre payload'dan türetilir.
     *
     * [TimelineKind.Unknown] için **açıkça** "gösterilemeyen kayıt" yazıyor; sessizce
     * atlamak, eksik bir geçmişi tam bir geçmiş gibi göstermek olurdu.
     */
    val title: String
        get() =
            when (kind) {
                TimelineKind.Appointment -> string("serviceName") ?: "Randevu"
                TimelineKind.Note -> kindLabelForNote()
                TimelineKind.Consent -> string("consentKind") ?: "Onam"
                TimelineKind.PackageSale -> string("definitionName") ?: "Paket satışı"
                TimelineKind.PackageLedger -> string("definitionName") ?: "Paket hareketi"
                TimelineKind.Unknown -> "Bu sürümde gösterilemeyen kayıt"
            }

    private fun kindLabelForNote(): String =
        string("kind")?.let { CustomerNoteKind.from(it).turkishName } ?: "Not"

    /** Satırın ikinci satırı; yoksa null. */
    val subtitle: String?
        get() =
            when (kind) {
                TimelineKind.Appointment -> string("status")
                TimelineKind.Note -> string("body")?.take(NOTE_PREVIEW_LENGTH)
                // Onam METNİNİN GÖVDESİ payload'da YOK (20k'lık bir aydınlatma metni her
                // sayfaya binerdi); sürüm kanıtın kendisidir.
                TimelineKind.Consent -> string("version")?.let { "Sürüm $it" }
                TimelineKind.PackageSale -> string("status")
                TimelineKind.PackageLedger -> string("entryType")
                TimelineKind.Unknown -> null
            }
}

private const val NOTE_PREVIEW_LENGTH = 120

/** Zaman çizelgesi sorgusu. */
data class TimelineQuery(
    val limit: Int? = null,
    val cursor: String? = null,
    /** Boş küme "belirtilmedi" demek, "hiçbiri" değil — sunucu da öyle yorumluyor. */
    val kinds: Set<TimelineKind> = emptySet(),
)
