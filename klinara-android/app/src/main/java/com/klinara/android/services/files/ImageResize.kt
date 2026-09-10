package com.klinara.android.services.files

import android.graphics.Bitmap
import androidx.core.graphics.scale
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

/**
 * Yükleme öncesi küçültme.
 *
 * ⚠️ **PİKSEL cinsinden çalışır, nokta (dp) cinsinden DEĞİL.** iOS'ta bu gerçek bir
 * hataydı: `UIImage.size` noktadır ve 3x ölçekli bir görselde nokta hesabı hedefin ÜÇ
 * KATINI üretiyordu — "2048'e indirildi" denen fotoğraf 6144 piksel kalıyor, yükleme
 * sınırı aşılabiliyor ve gereksiz büyük nesneler depolanıyordu.
 *
 * Android'de `Bitmap.width/height` zaten pikseldir; bu dosyanın varlık sebebi o
 * gerçeği **açıkça** yazmak ve testin pikselle ölçmesini sağlamak.
 */
object ImageResize {
    /** Uzun kenarın hedef piksel sınırı. */
    const val MAX_DIMENSION_PX = 2048

    /**
     * Kalite adımları: sınırın altına inene kadar sırayla denenir.
     *
     * En yüksekten başlıyor — klinik bir öncesi/sonrası fotoğrafında sıkıştırma
     * izleri, karşılaştırmayı tartışmalı hâle getirir.
     */
    private const val QUALITY_HIGH = 85
    private const val QUALITY_MEDIUM = 70
    private const val QUALITY_LOW = 55
    private const val QUALITY_MINIMUM = 40

    private val QUALITY_STEPS = listOf(QUALITY_HIGH, QUALITY_MEDIUM, QUALITY_LOW, QUALITY_MINIMUM)

    /**
     * Uzun kenarı [MAX_DIMENSION_PX]'e indirir; zaten küçükse dokunmaz.
     *
     * En-boy oranı korunur — bozmak, öncesi/sonrası karşılaştırmasını anlamsız kılardı.
     */
    fun scaled(source: Bitmap): Bitmap {
        val longest = maxOf(source.width, source.height)
        if (longest <= MAX_DIMENSION_PX) return source

        val ratio = MAX_DIMENSION_PX.toDouble() / longest
        val width = (source.width * ratio).roundToInt().coerceAtLeast(1)
        val height = (source.height * ratio).roundToInt().coerceAtLeast(1)
        return source.scale(width, height)
    }

    /**
     * Küçültür ve JPEG'e kodlar; [maxBytes]'ın altına inene kadar kaliteyi düşürür.
     *
     * Hiç sığmazsa **null döner** — sunucunun reddedeceği bir nesneyi yüklemeye
     * çalışmak, kullanıcıyı anlamsız bir hatayla karşılamak olurdu.
     */
    fun encode(
        source: Bitmap,
        maxBytes: Long = FileContentType.MAX_BYTES,
    ): ByteArray? {
        val bitmap = scaled(source)
        QUALITY_STEPS.forEach { quality ->
            val stream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, stream)
            val bytes = stream.toByteArray()
            if (bytes.size <= maxBytes) return bytes
        }
        return null
    }
}
