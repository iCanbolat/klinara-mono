package com.klinara.android.services.formatting

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import java.util.Locale

/**
 * Bu testler iOS `FormattingTests`'in assert ettiği stringleri **birebir** sürer.
 * Bir istemcide 1.500,50 ₺, diğerinde 1,500.50 ₺ göstermek iki ayrı ürün demektir.
 */
class MoneyTest {
    @Nested
    @DisplayName("format")
    inner class Format {
        @Test
        @DisplayName("Kuruş → Türkçe para biçimi")
        fun formatsMinorUnits() {
            assertEquals("1.500,00 ₺", Money.format(150_000))
            assertEquals("0,00 ₺", Money.format(0))
            assertEquals("12,34 ₺", Money.format(1234))
            assertEquals("1.234.567,89 ₺", Money.format(123_456_789))
        }

        @Test
        @DisplayName("Sembolsüz biçim giriş alanı için")
        fun formatsPlain() {
            assertEquals("1.500,00", Money.formatPlain(150_000))
            assertEquals("0,50", Money.formatPlain(50))
        }

        @Test
        @DisplayName("Ayırıcılar yerelden DEĞİL, açıkça kuruluyor — JVM ile cihaz aynı olmalı")
        fun separatorsAreExplicitNotLocaleDependent() {
            val previous = Locale.getDefault()
            try {
                // Cihaz yereli ne olursa olsun çıktı değişmemeli.
                Locale.setDefault(Locale.US)
                assertEquals("1.500,00 ₺", Money.format(150_000))
                Locale.setDefault(Locale.GERMANY)
                assertEquals("1.500,00 ₺", Money.format(150_000))
            } finally {
                Locale.setDefault(previous)
            }
        }
    }

    @Nested
    @DisplayName("parse")
    inner class Parse {
        @Test
        @DisplayName("Türkçe yazım: virgül ondalık, nokta binlik")
        fun parsesTurkishNotation() {
            assertEquals(150_050L, Money.parse("1.500,50"))
            assertEquals(150L, Money.parse("1,5"))
            assertEquals(123_456_789L, Money.parse("1.234.567,89"))
        }

        @Test
        @DisplayName("Nokta sezgisi: 1-2 basamak ondalık, 3 basamak binlik")
        fun disambiguatesDotSeparator() {
            // Bu ayrım olmadan "1500.50" → 150050 kuruş yerine 15005000 kuruş olurdu:
            // 1.500,50 ₺ yerine 150.050,00 ₺ — yüz katlık bir hata.
            assertEquals(150_050L, Money.parse("1500.50"))
            assertEquals(150L, Money.parse("1.5"))
            assertEquals(150_000L, Money.parse("1.500"))
        }

        @Test
        @DisplayName("Sembol ve boşluk temizlenir")
        fun stripsSymbolAndWhitespace() {
            assertEquals(150_000L, Money.parse("1.500,00 ₺"))
            assertEquals(150_000L, Money.parse(" 1.500,00 "))
        }

        @Test
        @DisplayName("Ayrıştırılamayan girdi null — sessizce 0 KABUL EDİLMEZ")
        fun returnsNullForUnparseableInput() {
            assertNull(Money.parse(""))
            assertNull(Money.parse("abc"))
            assertNull(Money.parse("-5"))
        }
    }

    @Test
    @DisplayName("Bankacı yuvarlaması: yarım kuruş en yakın ÇİFT'e gider")
    fun usesBankersRounding() {
        // Virgüllü yazım kullanılıyor: "1.125" noktalı yazımda BİNLİK ayırıcı sayılır
        // (üç basamak kuralı), yani 1125 lira olur — bu test onu değil, yuvarlamayı ölçüyor.
        //
        // 112,5 kuruş → 112 (çift), 113,5 kuruş → 114 (çift).
        // Yarı-yukarı olsaydı 113 ve 114 olurdu.
        assertEquals(112L, Money.parse("1,125"))
        assertEquals(114L, Money.parse("1,135"))
    }

    @Test
    @DisplayName("Nokta sezgisi bankacı testiyle karışmasın: '1.125' BİN yüz yirmi beş liradır")
    fun threeDigitsAfterDotIsThousandsSeparator() {
        assertEquals(112_500L, Money.parse("1.125"))
    }
}

class VatRateTest {
    @Test
    @DisplayName("Baz puan → yüzde")
    fun formatsBasisPoints() {
        assertEquals("%20", VatRate.format(2000))
        assertEquals("%0", VatRate.format(0))
        assertEquals("%10", VatRate.format(1000))
    }

    @Test
    @DisplayName("Yaygın oranlar seçici için hazır")
    fun exposesCommonRates() {
        assertEquals(listOf(0, 1000, 2000), VatRate.common)
    }
}

class DurationFormatTest {
    @Test
    @DisplayName("Dakika → okunur süre")
    fun formatsDuration() {
        assertEquals("45 dk", DurationFormat.format(45))
        assertEquals("1 sa 30 dk", DurationFormat.format(90))
        assertEquals("2 sa", DurationFormat.format(120))
        assertEquals("0 dk", DurationFormat.format(0))
    }
}

class SearchTextTest {
    @Test
    @DisplayName("Türkçe katlama: ı İ I hepsi i olur")
    fun foldsTurkishLetters() {
        assertEquals("istanbul", SearchText.fold("İstanbul"))
        assertEquals("isik", SearchText.fold("IŞIK"))
        assertEquals("igdir", SearchText.fold("Iğdır"))
        assertEquals("cogus", SearchText.fold("ÇÖĞÜŞ"))
        assertEquals("yilmaz", SearchText.fold("Yılmaz"))
    }

    @Test
    @DisplayName("KORUMA: lowercase() bu işi yapamaz — sadeleştirme denemesi burada kırılır")
    fun guardsAgainstNaiveLowercase() {
        // Türkçe yerelde "I" küçülünce "ı" olur; bizim katlamamız "i" vermeli.
        assertEquals("ı", "I".lowercase(Locale.forLanguageTag("tr")))
        assertEquals("i", SearchText.fold("I"))

        // ROOT yerelde "İ" küçülünce "i̇" (birleşen nokta) olur; bizimki temiz "i".
        assertEquals("i", SearchText.fold("İ"))

        // Ve asıl mesele: iki yazım birbirini bulmalı.
        assertEquals(SearchText.fold("YILMAZ"), SearchText.fold("Yılmaz"))
    }

    @Test
    @DisplayName("Türkçe klavyesi olmayan kullanıcı da bulabilmeli")
    fun matchesWithoutTurkishKeyboard() {
        assertTrue(SearchText.matches("Ayşe Yılmaz", "ayse"))
        assertTrue(SearchText.matches("Cilt Bakımı", "bakim"))
        assertTrue(SearchText.matches("İğne Şükrü", "igne"))
    }

    @Test
    @DisplayName("Boş terim filtre uygulanmamış demektir")
    fun emptyTermMatchesEverything() {
        assertTrue(SearchText.matches("herhangi", ""))
        assertTrue(SearchText.matches("herhangi", "   "))
    }

    @Test
    @DisplayName("Rakam araması biçimden bağımsız")
    fun digitSearchIgnoresFormatting() {
        assertTrue(SearchText.matchesDigits("+905321112233", "0532 111 22 33"))
        assertTrue(SearchText.matchesDigits("+905321112233", "5321112233"))
        assertFalse(SearchText.matchesDigits("+905321112233", "9999"))
        assertFalse(SearchText.matchesDigits(null, "532"))
        assertFalse(SearchText.matchesDigits("+905321112233", "abc"))
    }
}

class SlugTest {
    @Test
    @DisplayName("Türkçe addan slug")
    fun makesSlugFromTurkishName() {
        assertEquals("cilt-bakimi", Slug.make("Cilt Bakımı"))
        assertEquals("isil-guzellik", Slug.make("Işıl Güzellik"))
        assertEquals("ozel-sube", Slug.make("Özel Şube"))
    }

    @Test
    @DisplayName("ı harfi DÜŞMEZ — 'Işıl' → 'sl' hatasının koruması")
    fun dotlessIIsNotDropped() {
        assertEquals("isil", Slug.make("Işıl"))
    }

    @Test
    @DisplayName("Baştaki/sondaki tireler ve tekrarlar temizlenir")
    fun trimsSeparators() {
        assertEquals("merkez-sube", Slug.make("  Merkez   Şube  "))
        assertEquals("a-b", Slug.make("--a---b--"))
    }

    @Test
    @DisplayName("Sunucu deseni: 3-50 karakter, harf/rakam ile başlar ve biter")
    fun validatesAgainstServerPattern() {
        assertTrue(Slug.isValid("abc"))
        assertTrue(Slug.isValid("a" + "b".repeat(48) + "c"))
        assertFalse(Slug.isValid("ab"), "3 karakterden kısa")
        assertFalse(Slug.isValid("a".repeat(51)), "50 karakterden uzun")
        assertFalse(Slug.isValid("-abc"), "tire ile başlayamaz")
        assertFalse(Slug.isValid("abc-"), "tire ile bitemez")
        assertFalse(Slug.isValid("ABC"), "büyük harf olamaz")
        assertFalse(Slug.isValid("ab c"), "boşluk olamaz")
    }
}
