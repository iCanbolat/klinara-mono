package com.klinara.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraColors
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import kotlin.math.min

/**
 * Yoğunluk ısı ölçeği.
 *
 * Saf fonksiyon, Compose'suz test edilebilir. Renk **tek başına** bilgi taşımaz
 * (WCAG 1.4.1): her hücrenin `contentDescription`'ı sayıyı söylüyor ve bloklar
 * zaten metinle çizili.
 */
object DensityScale {
    /**
     * Boş saatin zemini. `sageDeep` değil `border` üzerine uygulanır — boş bir saat
     * "çok az yoğun" DEĞİL, ölçeğin dışıdır ve farklı bir renk ailesiyle anlatılır.
     */
    private const val EMPTY_ALPHA = 0.35f

    /**
     * Dolu saatlerin taban opaklığı.
     *
     * `0.25` iOS'tan geliyor ama **`EMPTY_ALPHA` ile karşılaştırılamaz**: ikisi farklı
     * renklere uygulanıyor (biri `border`, diğeri `sageDeep`). İlk yazımda bir test
     * ikisini aynı ölçekteymiş gibi kıyasladı ve `alpha(1, 8) = 0.344 < 0.35` çıktı —
     * ölçek bozuk değildi, testin varsayımı yanlıştı. Yine de bir şeyi ortaya çıkardı:
     * bu fonksiyon **yalnız dolu saatler için** tanımlı ve imzası bunu söylemeliydi.
     */
    private const val BASE_ALPHA = 0.25f
    private const val RANGE_ALPHA = 0.75f

    /**
     * Dolu bir saatin opaklığı. [count] en az 1 olmalı; sıfır [color]'da ayrı bir
     * dala gider ve buraya hiç düşmez.
     */
    fun alpha(
        count: Int,
        peak: Int,
    ): Float {
        val filled = maxOf(count, 1)
        val ratio = min(filled.toFloat() / maxOf(peak, 1).toFloat(), 1f)
        return BASE_ALPHA + RANGE_ALPHA * ratio
    }

    fun color(
        count: Int,
        peak: Int,
        colors: KlinaraColors,
    ): Color =
        if (count <= 0) {
            colors.border.copy(alpha = EMPTY_ALPHA)
        } else {
            colors.sageDeep.copy(alpha = alpha(count, peak))
        }

    /**
     * Aynı ölçeğin ZEMİN varyantı — hafta ızgarasının saat hücreleri için.
     *
     * Isı bir zemindir ve blokların arkasında kalmalı. İlk yazımda hücreler [color] ile
     * tam doygunlukta çizildi; `peak = 1` olan bir haftada (her saatte en çok bir
     * randevu) ekran koyu yeşil bir duvara dönüştü ve randevuları yuttu. Gün modundaki
     * [DensityStrip] tam doygunluğu KORUR: orada ısı zemin değil, bilginin kendisi.
     */
    fun backgroundColor(
        count: Int,
        peak: Int,
        colors: KlinaraColors,
    ): Color = color(count, peak, colors).let { it.copy(alpha = it.alpha * BACKGROUND_ALPHA) }

    /** iOS paritesi. */
    private const val BACKGROUND_ALPHA = 0.55f
}

/**
 * Gün modunun yoğunluk şeridi: saat başına bir kare.
 *
 * Izgaranın kendisi zaten blokları gösteriyor; şerit günün ŞEKLİNİ tek bakışta veriyor
 * (sabah dolu mu, öğleden sonra mı). Yoğunluk yoksa hiç çizilmez.
 */
@Composable
fun DensityStrip(
    counts: Map<Int, Int>,
    hours: IntRange,
    peak: Int,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(CELL_GAP),
    ) {
        hours.forEach { hour ->
            val count = counts[hour] ?: 0
            Box(
                modifier =
                    Modifier
                        .weight(1f)
                        .height(STRIP_HEIGHT)
                        .clip(RoundedCornerShape(CELL_RADIUS))
                        .background(DensityScale.color(count, peak, colors))
                        .clearAndSetSemantics {
                            contentDescription = "%02d:00, %d randevu".format(hour, count)
                        },
            )
        }
    }
}

/**
 * Ölçek açıklaması ve — varsa — kapsam notu.
 *
 * [note] boş geçilmez: sunucu yoğunluğu personel filtresine göre DARALTMIYOR ve bunu
 * söylememek, filtreli bir ekranda yanlış bir ısı haritasını doğruymuş gibi
 * göstermek olurdu.
 */
@Composable
fun DensityLegend(
    peak: Int,
    modifier: Modifier = Modifier,
    note: String? = null,
) {
    val colors = KlinaraTheme.colors
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        Text("Yoğunluk", style = KlinaraType.label, color = colors.charcoalMuted)
        listOf(0, 1, peak).distinct().forEach { count ->
            Box(
                modifier =
                    Modifier
                        .size(SWATCH_SIZE)
                        .clip(RoundedCornerShape(CELL_RADIUS))
                        .background(DensityScale.color(count, peak, colors)),
            )
        }
        Text("en çok $peak", style = KlinaraType.label, color = colors.charcoalMuted)
        if (note != null) {
            Text("· $note", style = KlinaraType.label, color = colors.charcoalMuted)
        }
    }
}

private val STRIP_HEIGHT = 10.dp
private val SWATCH_SIZE = 12.dp
private val CELL_GAP = 2.dp
private val CELL_RADIUS = 2.dp
