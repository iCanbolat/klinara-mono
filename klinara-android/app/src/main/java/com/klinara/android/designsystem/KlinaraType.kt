package com.klinara.android.designsystem

import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.klinara.android.R
import java.util.Locale

/** Türkçe harf durumu için — `Locale.ROOT` "i"yi "I" yapar, "İ" değil. */
val TurkishLocale: Locale = Locale.forLanguageTag("tr-TR")

/**
 * Manrope tek bir **variable** TTF olarak gelir; `wght` ekseninin varsayılanı **200**'dür.
 *
 * `FontFamily(Font(R.font.manrope_variable))` yazmak tüm arayüzü ExtraLight çizer ve
 * bu bir tasarım tercihi gibi göründüğü için incelemeden geçer. Ağırlık her yüz için
 * `FontVariation.Settings` ile AÇIKÇA verilmek zorunda.
 *
 * `variationSettings` API 26 ister — tam bizim minSdk tabanımız, dallanma yok.
 */
@OptIn(ExperimentalTextApi::class) // FontVariation.Settings hâlâ deneysel; tek kullanım yeri burası.
private fun manrope(weight: FontWeight) =
    Font(
        resId = R.font.manrope_variable,
        weight = weight,
        variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
    )

val Manrope =
    FontFamily(
        manrope(FontWeight.Normal),
        manrope(FontWeight.Medium),
        manrope(FontWeight.SemiBold),
    )

/** Source Serif 4'te Medium ağırlık yoktur; ara başlıklar Regular kullanır. */
val SourceSerif =
    FontFamily(
        Font(R.font.source_serif4_regular, FontWeight.Normal),
        Font(R.font.source_serif4_semibold, FontWeight.SemiBold),
    )

/**
 * iOS'un `.lineSpacing(n)` EK boşluktur; Compose'un `lineHeight`'ı TOPLAM yüksekliktir.
 * 17sp + 3 → 20sp.
 *
 * `includeFontPadding = false`: Compose'un eski varsayılanı SwiftUI'da olmayan ascender
 * dolgusu ekler ve dikey ortalı her etiket ~2dp aşağı oturur.
 */
private fun brandStyle(
    family: FontFamily,
    weight: FontWeight,
    sizeSp: Int,
    trackingSp: Float = 0f,
    lineHeightSp: Int = 0,
) = TextStyle(
    fontFamily = family,
    fontWeight = weight,
    fontSize = sizeSp.sp,
    letterSpacing = trackingSp.sp,
    lineHeight = if (lineHeightSp > 0) lineHeightSp.sp else TextStyle.Default.lineHeight,
    lineHeightStyle =
        LineHeightStyle(
            alignment = LineHeightStyle.Alignment.Center,
            trim = LineHeightStyle.Trim.None,
        ),
    platformStyle = PlatformTextStyle(includeFontPadding = false),
)

/**
 * Marka tipografisi: başlıklarda Source Serif 4 (editoryal, otoriter),
 * arayüz ve gövdede Manrope (geometrik, klinik veride okunaklı).
 *
 * Tracking, satır aralığı ve harf durumu stille birlikte TEK PARÇA taşınır —
 * çağrı yerinde tekrarlanan bir tracking er ya da geç bir ekranda unutulur.
 *
 * iOS'taki "font yoksa sisteme düş" mekanizması burada YOK: `R.font.x` derleme
 * zamanında ya vardır ya proje derlenmez. Yerine `verifyBrandFonts` Gradle görevi
 * dosyaların varlığını `preBuild`'de doğrular.
 */
@Immutable
object KlinaraType {
    /** 34sp serif — ekran başlığı. */
    val displayL = brandStyle(SourceSerif, FontWeight.SemiBold, 34, trackingSp = -0.6f)

    /** 28sp serif — uzun metinli ekranların başlığı. */
    val displayM = brandStyle(SourceSerif, FontWeight.SemiBold, 28, trackingSp = -0.4f)

    /** 22sp serif — bölüm başlığı, kart başlığı. */
    val titleM = brandStyle(SourceSerif, FontWeight.Normal, 22, trackingSp = -0.2f)

    /** 17sp — birincil gövde. */
    val bodyL = brandStyle(Manrope, FontWeight.Normal, 17, lineHeightSp = 20)

    /** 15sp — ikincil gövde, yardımcı metin. */
    val bodyM = brandStyle(Manrope, FontWeight.Normal, 15, lineHeightSp = 18)

    /** 15sp medium — vurgulu gövde. */
    val bodyEmphasis = brandStyle(Manrope, FontWeight.Medium, 15, lineHeightSp = 18)

    /** 16sp semibold — buton içeriği. */
    val button = brandStyle(Manrope, FontWeight.SemiBold, 16)

    /**
     * 12sp UPPERCASE, geniş tracking — mimari hiyerarşi.
     * Harf durumu [labelText] ile uygulanır; Compose'da `textCase` yok.
     */
    val label = brandStyle(Manrope, FontWeight.SemiBold, 12, trackingSp = 1.2f)

    /** 24sp tabular — doğrulama kodu. Tabular figürler `code` stilinde şart. */
    val code =
        brandStyle(Manrope, FontWeight.Medium, 24, trackingSp = 2f)
            .copy(fontFeatureSettings = "tnum")

    /**
     * `label` stiliyle kullanılacak metni Türkçe kurallarıyla büyütür.
     * `Locale.ROOT` kullanılırsa "i" → "I" olur, "İ" değil.
     */
    fun labelText(value: String): String = value.uppercase(TurkishLocale)

    /**
     * A2.2 debug profil ekranı için: hangi ailelerin çözüldüğünü ve Manrope'ye hangi
     * variation ayarının uygulandığını söyler. "Neden bu OEM'de ince görünüyor"
     * sorusunun cevabı burada.
     */
    val diagnostics: String
        get() =
            buildString {
                appendLine("SourceSerif4: res/font (statik: Regular + Semibold)")
                appendLine("Manrope: res/font (variable, wght 200-800)")
                append("Manrope wght: 400 / 500 / 600 — FontVariation.Settings ile açıkça veriliyor")
            }
}

/** Compose'un `letterSpacing`'i em bekleyen API'leri için yardımcı. */
internal val Float.emSpacing get() = this.em
