package com.klinara.android.services.networking

import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.LocalDate

@Serializable
private data class Moment(
    @Serializable(with = InstantSerializer::class) val at: Instant,
)

@Serializable
private data class Day(
    @Serializable(with = LocalDateSerializer::class) val on: LocalDate,
)

/**
 * Tarih çözümlemesi bilinen bir mayın: sunucu her zaman kesirli saniye ile gönderiyor
 * (`Date.toISOString()`), fixture'lar ve bazı alanlar ise şube offset'iyle kesirsiz.
 * İki biçim de çözülmeli, çıplak tarih ise ASLA bir `Instant`'a düşmemeli.
 */
class KlinaraJsonTest {
    @Test
    @DisplayName("Kesirli ve kesirsiz UTC aynı ana çözülür")
    fun bothFractionalAndPlainUtcDecode() {
        val withFraction = KlinaraJson.decodeFromString<Moment>("""{"at":"2026-08-27T09:15:00.000Z"}""")
        val withoutFraction = KlinaraJson.decodeFromString<Moment>("""{"at":"2026-08-27T09:15:00Z"}""")
        assertEquals(withFraction.at, withoutFraction.at)
    }

    @Test
    @DisplayName("Şube offset'i doğru çözülür")
    fun branchOffsetDecodes() {
        val moment = KlinaraJson.decodeFromString<Moment>("""{"at":"2026-09-07T14:00:00+03:00"}""")
        assertEquals(Instant.parse("2026-09-07T11:00:00Z"), moment.at)
    }

    @Test
    @DisplayName("Çıplak tarih bir Instant alanına DÜŞEMEZ")
    fun bareDateIsRejectedForInstant() {
        assertThrows(SerializationException::class.java) {
            KlinaraJson.decodeFromString<Moment>("""{"at":"2026-09-09"}""")
        }
    }

    @Test
    @DisplayName("Offset'siz zaman damgası da reddedilir")
    fun offsetlessTimestampIsRejected() {
        assertThrows(SerializationException::class.java) {
            KlinaraJson.decodeFromString<Moment>("""{"at":"2026-09-09T10:00:00"}""")
        }
    }

    @Test
    @DisplayName("Kodlama tam üç kesir hanesi ve Z üretir — sunucunun toISOString'i ile birebir")
    fun encodesWithExactlyThreeFractionDigits() {
        val json = KlinaraJson.encodeToString(Moment(Instant.parse("2026-08-27T09:15:00Z")))
        assertEquals("""{"at":"2026-08-27T09:15:00.000Z"}""", json)
    }

    @Test
    @DisplayName("LocalDate yalnız yyyy-MM-dd kabul eder")
    fun localDateAcceptsOnlyCalendarDay() {
        assertEquals(LocalDate.of(2026, 9, 9), KlinaraJson.decodeFromString<Day>("""{"on":"2026-09-09"}""").on)
        assertThrows(SerializationException::class.java) {
            KlinaraJson.decodeFromString<Day>("""{"on":"2026-09-09T10:00:00Z"}""")
        }
    }

    @Test
    @DisplayName("Bilinmeyen alanlar yok sayılır — sunucu alan eklediğinde eski istemci çökmez")
    fun ignoresUnknownFields() {
        val moment =
            KlinaraJson.decodeFromString<Moment>(
                """{"at":"2026-08-27T09:15:00.000Z","yeniAlan":"sonraki sürüm"}""",
            )
        assertEquals(Instant.parse("2026-08-27T09:15:00Z"), moment.at)
    }
}
