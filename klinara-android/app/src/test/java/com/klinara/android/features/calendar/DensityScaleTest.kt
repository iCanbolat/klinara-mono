package com.klinara.android.features.calendar

import com.klinara.android.designsystem.components.DensityScale
import com.klinara.android.designsystem.LightKlinaraColors
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

class DensityScaleTest {
    @Test
    @DisplayName("Boş saat ile dolu saat AYRI RENK ailesinden — alfa kıyaslanamaz")
    fun emptyAndFilledUseDifferentHues() {
        // İlk yazımda bu test `alpha(0, 8) < alpha(1, 8)` bekliyordu ve kırıldı:
        // boş saat `border`, dolu saat `sageDeep` üzerine uygulanıyor. Aynı ölçekte
        // değiller ve olmamalılar — boş bir saat "çok az yoğun" değil, ölçeğin dışı.
        val light = LightKlinaraColors
        assertNotEquals(
            DensityScale.color(count = 0, peak = 8, colors = light),
            DensityScale.color(count = 1, peak = 8, colors = light),
            "Tek randevulu bir saat boş bir saatle aynı çizilseydi ısı haritası " +
                "günün en sessiz saatlerini gizlerdi.",
        )
    }

    @Test
    @DisplayName("Tepe değerdeki saat ölçeğin üst ucunu alır")
    fun peakSaturates() {
        assertEquals(1f, DensityScale.alpha(count = 8, peak = 8))
    }

    @Test
    @DisplayName("Tepeyi aşan sayı ölçeği TAŞIRMAZ")
    fun aboveThePeakClamps() {
        // Yoğunluk kovaları ile görünen randevular ayrı sorgulardan gelebiliyor;
        // sayının tepeyi aşması bir çökme ya da 1'i geçen bir alfa üretmemeli.
        assertEquals(1f, DensityScale.alpha(count = 99, peak = 8))
    }

    @Test
    @DisplayName("Tepe sıfırken bölme hatası olmaz")
    fun zeroPeakIsSafe() {
        assertTrue(DensityScale.alpha(count = 1, peak = 0) <= 1f)
    }

    @Test
    @DisplayName("Ölçek monoton artar")
    fun scaleIsMonotonic() {
        val values = (1..8).map { DensityScale.alpha(it, peak = 8) }
        assertEquals(values.sorted(), values, "Daha yoğun bir saat daha koyu çizilmeli.")
    }
}
