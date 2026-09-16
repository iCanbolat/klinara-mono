package com.klinara.android.services.formatting

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Türkçe biçimlendirme yereli. */
internal val TrLocale: Locale = Locale.forLanguageTag("tr-TR")

/**
 * Para biçimlendirme ve ayrıştırma — **tek yer**.
 *
 * Sunucu tutarları `bigint` **kuruş** olarak gönderiyor; istemcide `Long` kalır.
 * `Double`/`Float` YASAK: bir kez kayan noktaya düşen tutar 0,1 + 0,2 ≠ 0,3 dünyasına
 * girer ve ciro toplamlarında kuruş hatası birikir.
 *
 * **`NumberFormat.getCurrencyInstance` KULLANILMAZ.** JVM (JDK CLDR) ve Android (ICU)
 * aynı yerel için farklı çıktı verir — sembol konumu ve NBSP vs normal boşluk. Birim
 * testleri yeşil olur, cihazda çıktı yanlış olurdu. Ayırıcılar ve sembol AÇIKÇA
 * kuruluyor; böylece JVM ile cihaz yapı gereği aynı.
 */
object Money {
    private const val MINOR_UNITS_PER_MAJOR = 100L
    private const val FRACTION_DIGITS = 2
    private const val LIRA_SYMBOL = "₺"

    private val symbols =
        DecimalFormatSymbols(TrLocale).apply {
            groupingSeparator = '.'
            decimalSeparator = ','
        }

    private fun formatter() =
        DecimalFormat("#,##0.00", symbols).apply {
            roundingMode = RoundingMode.HALF_EVEN
        }

    /** Kuruş → "1.500,00 ₺". */
    fun format(
        minor: Long,
        currency: String = "TRY",
    ): String {
        val amount = formatPlain(minor)
        val symbol = if (currency == "TRY") LIRA_SYMBOL else currency
        return "$amount $symbol"
    }

    /** Sembolsüz biçim — giriş alanının içinde sembol tekrar edilmesin diye. */
    fun formatPlain(minor: Long): String =
        formatter().format(
            BigDecimal.valueOf(minor).divide(
                BigDecimal.valueOf(MINOR_UNITS_PER_MAJOR),
                FRACTION_DIGITS,
                // Bankacı yuvarlaması: iOS `NSDecimalNumberHandler(.bankers)` paritesi.
                RoundingMode.HALF_EVEN,
            ),
        )

    /**
     * Kullanıcının yazdığı metni kuruşa çevirir. "1.500,50" ve "1500.50" ikisi de kabul.
     *
     * Ayrıştırılamayan girdi `null` döner — sessizce 0 kabul etmek, kullanıcının
     * yazdığından farklı bir fiyat kaydetmenin en kestirme yoludur.
     */
    fun parse(text: String): Long? {
        val stripped =
            text
                .replace(LIRA_SYMBOL, "")
                .replace(" ", "")
                .replace(" ", "")
                .trim()

        val cleaned = normalizeSeparators(stripped)
        if (cleaned.isEmpty()) return null

        val decimal = runCatching { BigDecimal(cleaned) }.getOrNull() ?: return null
        if (decimal.signum() < 0) return null

        return decimal
            .multiply(BigDecimal.valueOf(MINOR_UNITS_PER_MAJOR))
            .setScale(0, RoundingMode.HALF_EVEN)
            .toLong()
    }

    /**
     * Nokta ve virgülün hangisinin ondalık olduğunu ayırır.
     *
     * Virgül varsa Türkçe yazım kesindir: noktalar binlik ayırıcıdır. Virgül yoksa tek
     * bir noktanın ardından **bir ya da iki** basamak geliyorsa bu ondalıktır
     * (`1500.50`), üç basamak geliyorsa binlik ayırıcıdır (`1.500`).
     *
     * Bu ayrım olmadan `"1500.50"` girişi noktası silinip `150050` oluyor ve 1.500,50 ₺
     * yerine **150.050,00 ₺** kaydediliyordu — yüz katlık bir hata.
     */
    private fun normalizeSeparators(raw: String): String {
        if (raw.contains(',')) {
            return raw.replace(".", "").replace(',', '.')
        }
        val parts = raw.split('.')
        if (parts.size == 2 && parts[1].length in 1..FRACTION_DIGITS) return raw
        return raw.replace(".", "")
    }
}

/** KDV oranı — sunucu **baz puan** (bps) taşır: %20 = 2000. */
object VatRate {
    private const val BPS_PER_PERCENT = 100

    fun format(basisPoints: Int): String {
        val whole = basisPoints / BPS_PER_PERCENT
        val remainder = basisPoints % BPS_PER_PERCENT
        return if (remainder == 0) {
            "%$whole"
        } else {
            "%" + Money.formatPlain(basisPoints.toLong())
        }
    }

    const val ZERO = 0
    const val TEN_PERCENT = 1000
    const val TWENTY_PERCENT = 2000

    /** Yaygın Türkiye KDV oranları — seçici için. */
    val common: List<Int> = listOf(ZERO, TEN_PERCENT, TWENTY_PERCENT)
}

/** Süre biçimlendirme: 90 → "1 sa 30 dk". */
object DurationFormat {
    private const val MINUTES_PER_HOUR = 60

    fun format(minutes: Int): String {
        val hours = minutes / MINUTES_PER_HOUR
        val remaining = minutes % MINUTES_PER_HOUR
        return when {
            hours == 0 -> "$remaining dk"
            remaining == 0 -> "$hours sa"
            else -> "$hours sa $remaining dk"
        }
    }
}
