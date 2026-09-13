package com.klinara.android.features.reports

import com.klinara.android.services.formatting.TrLocale
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import kotlin.math.abs

/**
 * Rapor ekranlarının ortak biçimlendiricileri — iOS `ReportFormat` paritesi.
 *
 * ⚠️ HİÇBİRİ HESAP YAPMIYOR. Oranlar ve yüzde değişimler sunucudan geldiği gibi; buradaki tek
 * iş onları okunur kılmak. Ayraçlar `Money` gibi AÇIKÇA kuruluyor: JVM ile cihazın `tr-TR`
 * çıktısı farklı olabiliyor ve testler yeşilken ekran yanlış olurdu.
 */
object ReportFormat {
    private val symbols =
        DecimalFormatSymbols(TrLocale).apply {
            groupingSeparator = '.'
            decimalSeparator = ','
            minusSign = '-'
        }

    private fun formatter() =
        DecimalFormat("#,##0.##", symbols).apply { roundingMode = RoundingMode.HALF_EVEN }

    /** `1234.5` → `"1.234,5"`. */
    fun number(value: Double): String = formatter().format(value)

    /** Yüzde — sunucu zaten yüzde gönderiyor: `33.33` → `"%33,33"` (Türkçe yazımda işaret önde). */
    fun percent(value: Double): String = "%${number(value)}"

    /**
     * Yüzde değişim: `12.5` → `"+%12,5"`, `-8.4` → `"−%8,4"`, `0` → `"%0"`.
     *
     * `null` KIYASLANAMAZ demek (önceki dönem 0) — "%0" DEĞİL; çağıran onu ayrıca "yeni" diye
     * yazar ([deltaLabel]). Eksi işareti tipografik (U+2212): tire ile karışmasın.
     */
    fun delta(value: Double?): String? {
        value ?: return null
        val sign =
            when {
                value > 0 -> "+"
                value < 0 -> "−"
                else -> ""
            }
        return "$sign%${number(abs(value))}"
    }

    /**
     * Gün kırılımının etiketi. Sunucu şubenin YEREL gününü `YYYY-MM-DD` olarak yazıyor (kimlik
     * olarak da o kullanılıyor); ekranda "1 Eylül Salı", grafik ekseninde "1 Eyl". Saat dilimi
     * dönüşümü YOK — gün zaten yerel. Ayrıştırılamayan etiket olduğu gibi kalır.
     */
    fun dayTitle(raw: String): String = parseDay(raw)?.let(DAY_TITLE::format) ?: raw

    fun dayShort(raw: String): String = parseDay(raw)?.let(DAY_SHORT::format) ?: raw

    /** Kırılım başlığı: gün kırılımında Türkçe tarih, diğerlerinde sunucunun etiketi. */
    fun groupTitle(
        raw: String,
        isDaily: Boolean,
    ): String = if (isDaily) dayTitle(raw) else raw

    private fun parseDay(raw: String): LocalDate? = runCatching { LocalDate.parse(raw) }.getOrNull()

    private val DAY_TITLE = DateTimeFormatter.ofPattern("d MMMM EEEE", TrLocale)
    private val DAY_SHORT = DateTimeFormatter.ofPattern("d MMM", TrLocale)

    /**
     * Toplam satırının alt metni. Karşılaştırma kapalıysa `null`; açıksa ya değişim ya da
     * "önceki dönemde sıfırdı" — anahtarın hiç gelmemesi de (rapor o alanı kıyaslamıyor) `null`.
     */
    fun deltaLabel(
        delta: Map<String, Double?>?,
        key: String,
    ): String? {
        if (delta == null || !delta.containsKey(key)) return null
        return delta[key]?.let { "Önceki döneme göre ${delta(it)}" } ?: "Önceki dönemde sıfırdı — kıyaslanamaz"
    }
}
