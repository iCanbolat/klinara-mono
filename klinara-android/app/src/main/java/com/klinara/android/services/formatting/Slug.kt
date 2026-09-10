package com.klinara.android.services.formatting

import java.text.Normalizer
import java.util.Locale

/**
 * Sunucunun `SLUG_PATTERN`'ine (`^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$`) uyan kod üretimi.
 *
 * Kullanıcı slug yazmak zorunda kalmasın diye addan türetilir. Türkçe karakterler genel
 * bir çeviriye BIRAKILMAZ: `ı` harfi bazı dönüşümlerde tamamen düşer ve "Işıl" → "sl"
 * gibi bir kod üretir.
 */
object Slug {
    private const val MIN_LENGTH = 3
    private const val MAX_LENGTH = 50

    private val turkishMap: Map<Char, String> =
        mapOf(
            'ç' to "c", 'ğ' to "g", 'ı' to "i", 'ö' to "o", 'ş' to "s", 'ü' to "u",
            'Ç' to "c", 'Ğ' to "g", 'İ' to "i", 'I' to "i", 'Ö' to "o", 'Ş' to "s", 'Ü' to "u",
        )

    fun make(name: String): String {
        val output = StringBuilder()
        var lastWasSeparator = true

        for (character in name) {
            lastWasSeparator = append(character, output, lastWasSeparator)
        }

        // Baştaki/sondaki tireler desene takılır.
        return output.toString().trim('-').take(MAX_LENGTH)
    }

    /**
     * Tek karakteri işler ve "son yazılan bir ayırıcı mıydı" durumunu döndürür.
     *
     * Ayrı bir fonksiyon: gövde bir karakter durum makinesi ve döngünün içinde
     * yazıldığında dört seviye iç içe bloğa çıkıyor.
     */
    private fun append(
        character: Char,
        output: StringBuilder,
        lastWasSeparator: Boolean,
    ): Boolean {
        val mapped = turkishMap[character]
        val text =
            when {
                mapped != null -> mapped
                // Latin'e indirilemeyen bir harf (örn. Kiril) ayırıcı gibi davranır.
                character.isLetterOrDigit() -> asciiFold(character)
                else -> ""
            }

        if (text.isNotEmpty()) {
            output.append(text)
            return false
        }

        // Ayırıcı: art arda tire yazılmaz.
        if (!lastWasSeparator) output.append('-')
        return true
    }

    /** Sunucu en az 3, en çok 50 karakter ister. */
    fun isValid(slug: String): Boolean =
        slug.length in MIN_LENGTH..MAX_LENGTH && PATTERN.matches(slug)

    /** Türkçe dışı aksanlar (é, â) ASCII'ye indirilir; indirilemeyen karakter düşer. */
    private fun asciiFold(character: Char): String =
        Normalizer
            .normalize(character.lowercase(Locale.ROOT), Normalizer.Form.NFD)
            .filter { it.code < ASCII_LIMIT && it.isLetterOrDigit() }

    private const val ASCII_LIMIT = 128
    private val PATTERN = "^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$".toRegex()
}
