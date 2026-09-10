package com.klinara.android.services.networking

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.format.DateTimeParseException

/**
 * Tüm çözümleme ve kodlamanın tek noktası.
 *
 * `explicitNulls = false`: WebAuthn zarfları ve kısmi güncelleme gövdeleri null
 * alanları ATLAR — iOS'un `Encodable` davranışının karşılığı. Aksi hâlde sunucuya
 * `{"attestationObject": null}` gider ve doğrulama patlar.
 */
val KlinaraJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = false
        isLenient = false
        coerceInputValues = false
    }

/**
 * ISO-8601 zaman damgası.
 *
 * Sunucu her zaman kesirli saniye ile gönderiyor (`Date.toISOString()` → `.000Z`) ama
 * fixture'lar ve bazı alanlar şube offset'iyle kesirsiz geliyor. `ISO_OFFSET_DATE_TIME`
 * ikisini de kabul eder, dolayısıyla iOS'un iki-formatter sorunu Android'de yok.
 *
 * **Bilerek korunan yarısı:** çıplak bir tarih (`2026-09-09`) `Instant`'a çözülmemeli.
 * `ISO_OFFSET_DATE_TIME` offset zorunlu kıldığı için bu bedava geliyor. Çıplak tarih
 * alanları [LocalDateSerializer] kullanır — biri diğerinin yerine geçemez.
 *
 * `Instant.parse` KULLANILMAZ: offset davranışı Java sürümleri arasında değişti ve
 * API 26'da desugar kütüphanesinin o davranışın anlık görüntüsüne kalırsınız.
 */
object InstantSerializer : KSerializer<Instant> {
    /** Sunucunun `Date.toISOString()`'i her zaman milisaniye basar. */
    private const val FRACTION_DIGITS = 3

    private val OUT: DateTimeFormatter =
        DateTimeFormatterBuilder().appendInstant(FRACTION_DIGITS).toFormatter()

    override val descriptor = PrimitiveSerialDescriptor("java.time.Instant", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): Instant {
        val raw = decoder.decodeString()
        return try {
            OffsetDateTime.parse(raw, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant()
        } catch (e: DateTimeParseException) {
            throw SerializationException("ISO 8601 zaman damgası çözülemedi: $raw", e)
        }
    }

    override fun serialize(
        encoder: Encoder,
        value: Instant,
    ) = encoder.encodeString(OUT.format(value))
}

/** `yyyy-MM-dd` — takvim günü. Bir zaman damgası buraya düşemez. */
object LocalDateSerializer : KSerializer<LocalDate> {
    override val descriptor = PrimitiveSerialDescriptor("java.time.LocalDate", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): LocalDate {
        val raw = decoder.decodeString()
        return try {
            LocalDate.parse(raw, DateTimeFormatter.ISO_LOCAL_DATE)
        } catch (e: DateTimeParseException) {
            throw SerializationException("Tarih çözülemedi: $raw", e)
        }
    }

    override fun serialize(
        encoder: Encoder,
        value: LocalDate,
    ) = encoder.encodeString(DateTimeFormatter.ISO_LOCAL_DATE.format(value))
}
