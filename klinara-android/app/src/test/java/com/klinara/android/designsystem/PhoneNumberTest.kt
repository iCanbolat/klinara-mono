package com.klinara.android.designsystem

import com.klinara.android.designsystem.components.PhoneNumber
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test

/**
 * iOS `PhoneNumberField`'ın statik yardımcılarıyla aynı vakaları sürer. Bu davranış
 * iki istemcide ayrışırsa aynı numara iki farklı E.164 üretir ve sunucuda iki müşteri
 * kaydı doğar.
 */
class PhoneNumberTest {
    @Nested
    @DisplayName("extractDigits")
    inner class ExtractDigits {
        @Test
        @DisplayName("Yapıştırılan her biçimi tek bir on haneye indirger")
        fun normalisesEveryInputShape() {
            val expected = "5321234567"
            assertEquals(expected, PhoneNumber.extractDigits("5321234567"))
            assertEquals(expected, PhoneNumber.extractDigits("05321234567"))
            assertEquals(expected, PhoneNumber.extractDigits("+905321234567"))
            assertEquals(expected, PhoneNumber.extractDigits("+90 532 123 45 67"))
            assertEquals(expected, PhoneNumber.extractDigits("0532 123 45 67"))
            assertEquals(expected, PhoneNumber.extractDigits("(0532) 123-45-67"))
        }

        @Test
        @DisplayName("On haneden fazlası kırpılır")
        fun trimsBeyondTenDigits() {
            assertEquals("5321234567", PhoneNumber.extractDigits("53212345678999"))
        }

        @Test
        @DisplayName("90 öneki yalnız fazlalık varken atılır — 90 ile başlayan yerel numara korunur")
        fun keepsLocalNumberStartingWithNinety() {
            // 9012345678 geçerli bir on hanedir; "90" ülke kodu sanılıp atılmamalı.
            assertEquals("9012345678", PhoneNumber.extractDigits("9012345678"))
        }

        @Test
        @DisplayName("Boş ve harf içeren girdi boş döner")
        fun emptyForNonDigits() {
            assertEquals("", PhoneNumber.extractDigits(""))
            assertEquals("", PhoneNumber.extractDigits("telefon yok"))
        }
    }

    @Nested
    @DisplayName("format")
    inner class Format {
        @Test
        @DisplayName("3-3-2-2 gruplama")
        fun groupsThreeThreeTwoTwo() {
            assertEquals("532 123 45 67", PhoneNumber.format("5321234567"))
        }

        @Test
        @DisplayName("Yarım numarada da boşluklar doğru yerde")
        fun groupsPartialInput() {
            assertEquals("5", PhoneNumber.format("5"))
            assertEquals("532", PhoneNumber.format("532"))
            assertEquals("532 1", PhoneNumber.format("5321"))
            assertEquals("532 123", PhoneNumber.format("532123"))
            assertEquals("532 123 4", PhoneNumber.format("5321234"))
            assertEquals("532 123 45", PhoneNumber.format("53212345"))
            assertEquals("532 123 45 6", PhoneNumber.format("532123456"))
        }
    }

    @Nested
    @DisplayName("toE164")
    inner class ToE164 {
        @Test
        @DisplayName("Yalnız tam numara E.164 üretir — yarım numara sunucuya gitmez")
        fun onlyCompleteNumberProducesE164() {
            assertEquals("+905321234567", PhoneNumber.toE164("5321234567"))
            assertEquals("", PhoneNumber.toE164("532123456"))
            assertEquals("", PhoneNumber.toE164(""))
        }
    }

    @Test
    @DisplayName("pretty: özet satırı biçimi")
    fun prettyFormatsForSummaryRows() {
        assertEquals("+90 532 123 45 67", PhoneNumber.pretty("+905321234567"))
        // +90 olmayan bir numara olduğu gibi gösterilir, bozulmaz.
        assertEquals("+15551234567", PhoneNumber.pretty("+15551234567"))
    }

    @Test
    @DisplayName("Gidiş-dönüş: yazılan her ara adım kendini geri okuyabilmeli")
    fun everyIntermediateStateSurvivesRoundTrip() {
        // A0.3'te yakalanan hatanın regresyon testi: alan `extractDigits(e164)` ile
        // türetilseydi, toE164("") boş döndüğü için ilk dokuz tuş vuruşu kaybolurdu.
        val full = "5321234567"
        for (length in 1..full.length) {
            val typed = full.take(length)
            val digits = PhoneNumber.extractDigits(typed)
            assertEquals(typed, digits, "$length hane geri okunamadı")
        }
    }
}
