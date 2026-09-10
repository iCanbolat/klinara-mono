package com.klinara.android.services.formatting

import java.text.Normalizer
import java.util.Locale

/**
 * Metin araması — Türkçe için.
 *
 * **`lowercase()` bu dilde çalışmaz.** `"YILMAZ".lowercase()` noktalı `"yilmaz"` verir,
 * `"Yılmaz".lowercase()` ise noktasız `"yılmaz"`. İkisi eşleşmez ve kullanıcı kendi
 * yazdığı adı bulamaz. `Locale("tr")` ile küçültmek de çözmez, ters yöne kaydırır:
 * `"I".lowercase(tr)` → `"ı"` olur ve `"iğne"` araması `"İĞNE"`yi bulamaz.
 *
 * Bu yüzden AÇIK bir harf haritası var. `SearchTextTest` bu haritayı bir koruma
 * testiyle sabitliyor: ileride biri "sadeleştirip `lowercase()` kullanalım" derse
 * test gürültüyle kırılır.
 */
object SearchText {
    /**
     * `ı` bir aksanlı `i` DEĞİL, ayrı bir temel harftir; Unicode aksan katlaması onu
     * `i`ye indirmez. `İ` de simetrik olarak `i`ye inmeli.
     */
    private val foldMap: Map<Char, Char> =
        mapOf(
            'ı' to 'i', 'İ' to 'i', 'I' to 'i',
            'ç' to 'c', 'Ç' to 'c',
            'ğ' to 'g', 'Ğ' to 'g',
            'ö' to 'o', 'Ö' to 'o',
            'ş' to 's', 'Ş' to 's',
            'ü' to 'u', 'Ü' to 'u',
        )

    /**
     * Karşılaştırma biçimine indirger: Türkçe harfler ASCII'ye, kalan aksanlar
     * Unicode NFD ayrıştırmasıyla, sonra `Locale.ROOT` ile küçük harfe.
     *
     * Türkçe eşlemesi ÖNCE uygulanır; sonra gelen `lowercase(Locale.ROOT)` artık
     * `I` ya da `İ` görmez.
     */
    fun fold(value: String): String {
        val mapped = value.map { foldMap[it] ?: it }.joinToString("")
        return Normalizer
            .normalize(mapped, Normalizer.Form.NFD)
            .replace(COMBINING_MARKS, "")
            .lowercase(Locale.ROOT)
    }

    /** Boş arama terimi her şeyle eşleşir — filtre uygulanmamış demektir. */
    fun matches(
        haystack: String,
        term: String,
    ): Boolean {
        val needle = term.trim()
        if (needle.isEmpty()) return true
        return fold(haystack).contains(fold(needle))
    }

    /**
     * Yalnız rakamları karşılaştırır — kullanıcı numarayı biçimli de yazsa
     * (`0532 111 22 33`) E.164 kaydı (`+905321112233`) bulunabilmeli.
     */
    fun matchesDigits(
        haystack: String?,
        term: String,
    ): Boolean {
        val digits = term.filter(Char::isDigit)
        if (digits.isEmpty() || haystack == null) return false
        return haystack.filter(Char::isDigit).contains(digits)
    }

    private val COMBINING_MARKS = "\\p{Mn}+".toRegex()
}
