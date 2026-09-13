package com.klinara.android.designsystem.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt

@Immutable
data class KlinaraChartPoint(
    val id: String,
    val label: String,
    val value: Double,
)

enum class KlinaraChartKind { Bar, Line }

/**
 * Çubuk / çizgi grafik — Compose `Canvas` ile (A9). iOS `KlinaraChart` (Swift Charts) paritesi.
 *
 * **Grafik kütüphanesi eklenmedi** (§7.7): ihtiyaç iki işaret türü, bir y ekseni ve kırpılan x
 * etiketleri. Vico/MPAndroidChart bunun için bir bağımlılık ve kendi tema sistemleri getirirdi.
 *
 * ⚠️ **GRAFİK İKİNCİL ve ekran okuyucudan GİZLİ** (`clearAndSetSemantics`). Her rapor ekranında
 * aynı satırlar ayrıca `KlinaraRow` olarak listeleniyor ve gerçeğin kaynağı o liste; bir grafiği
 * TalkBack'e anlamlı kılmaya çalışmak yerine aynı veriyi erişilebilir bir listede vermek hem daha
 * dürüst hem daha az kod (iOS `accessibilityHidden` kararının aynısı).
 *
 * Değerler 0 tabanlı çizilir; negatif değer gelirse taban 0'da kalır (raporlarda oran ve tutar
 * negatif olmuyor). Tek noktalı çizgi görünmez bir nokta olurdu — o durumda sütun çizilir.
 */
@Composable
fun KlinaraChart(
    kind: KlinaraChartKind,
    points: List<KlinaraChartPoint>,
    format: (Double) -> String,
    modifier: Modifier = Modifier,
    /** Sayım verisi (müşteri, randevu): eksen adımı en az 1 — "0,5 müşteri" yazılmaz. */
    integerValues: Boolean = false,
    /** Çizim alanının yüksekliği; etiketler ve iç boşluk buna eklenir. */
    height: Dp = PLOT_HEIGHT,
) {
    if (points.isEmpty()) return
    val colors = KlinaraTheme.colors
    val measurer = rememberTextMeasurer()
    val style = KlinaraType.label.copy(color = colors.charcoalMuted)
    val palette = ChartPalette(mark = colors.sageDeep, grid = colors.border)
    val axis = remember(points, integerValues) { niceAxis(points.maxOf { it.value }, integerValues) }
    // Çizim alanı [height]; x etiketinin yüksekliği ÜSTÜNE eklenir — büyük yazıda (fontScale 2.0)
    // etiket büyürken çubukların ezilmemesi için.
    val labelHeight = with(LocalDensity.current) { measurer.measure("Ag", style).size.height.toDp() }

    Canvas(
        modifier =
            modifier
                .fillMaxWidth()
                .height(height + labelHeight + GAP + KlinaraMetrics.md * 2)
                .padding(KlinaraMetrics.md)
                .clearAndSetSemantics { },
    ) {
        drawChart(kind, points, axis, format, measurer, style, palette)
    }
}

private data class ChartPalette(
    val mark: Color,
    val grid: Color,
)

@Suppress("LongParameterList")
private fun DrawScope.drawChart(
    kind: KlinaraChartKind,
    points: List<KlinaraChartPoint>,
    axis: ChartAxis,
    format: (Double) -> String,
    measurer: TextMeasurer,
    style: TextStyle,
    palette: ChartPalette,
) {
    val top = axis.top
    val ticks = axis.ticks
    val tickLabels = ticks.map { measurer.measure(format(it), style, maxLines = 1) }
    val axisWidth = tickLabels.maxOf { it.size.width } + GAP.toPx()
    val labelHeight = measurer.measure("Ag", style).size.height
    val plot = Size(size.width - axisWidth, size.height - labelHeight - GAP.toPx())
    if (plot.width <= 0f || plot.height <= 0f) return

    fun y(value: Double): Float = plot.height - (value.coerceAtLeast(0.0) / top * plot.height).toFloat()

    // Izgara + y etiketleri.
    ticks.forEachIndexed { index, tick ->
        val lineY = y(tick)
        drawLine(palette.grid, Offset(axisWidth, lineY), Offset(size.width, lineY), GRID_STROKE.toPx())
        val label = tickLabels[index]
        drawText(label, topLeft = Offset(0f, (lineY - label.size.height / 2f).coerceIn(0f, plot.height)))
    }

    val slot = plot.width / points.size
    val centers = points.indices.map { axisWidth + slot * it + slot / 2f }
    if (kind == KlinaraChartKind.Line && points.size > 1) {
        val path = Path()
        points.forEachIndexed { index, point ->
            val offset = Offset(centers[index], y(point.value))
            if (index == 0) path.moveTo(offset.x, offset.y) else path.lineTo(offset.x, offset.y)
        }
        val stroke = Stroke(LINE_STROKE.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        drawPath(path, palette.mark, style = stroke)
        if (slot >= DOT_MIN_SLOT.toPx()) {
            points.forEachIndexed { index, point ->
                drawCircle(palette.mark, DOT_RADIUS.toPx(), Offset(centers[index], y(point.value)))
            }
        }
    } else {
        val barWidth = max(slot * BAR_FILL, MIN_BAR.toPx())
        val radius = CornerRadius(BAR_RADIUS.toPx())
        points.forEachIndexed { index, point ->
            val barTop = y(point.value)
            val path =
                Path().apply {
                    addRoundRect(
                        RoundRect(
                            left = centers[index] - barWidth / 2f,
                            top = barTop,
                            right = centers[index] + barWidth / 2f,
                            bottom = plot.height,
                            topLeftCornerRadius = radius,
                            topRightCornerRadius = radius,
                        ),
                    )
                }
            drawPath(path, palette.mark)
        }
    }

    drawXLabels(points, centers, slot, plot.height + GAP.toPx(), measurer, style)
}

/**
 * X etiketleri. Sığmayanlar kırpılır (tek satır, üç nokta); çok noktada (gün kırılımı) yalnız
 * ilk, orta ve son etiket yazılır — 30 etiketi yan yana sıkıştırmak hiçbirini okunur bırakmaz.
 */
@Suppress("LongParameterList")
private fun DrawScope.drawXLabels(
    points: List<KlinaraChartPoint>,
    centers: List<Float>,
    slot: Float,
    baseline: Float,
    measurer: TextMeasurer,
    style: TextStyle,
) {
    val sparse = points.size > DENSE_LIMIT
    val shown =
        if (sparse) setOf(0, points.lastIndex / 2, points.lastIndex) else points.indices.toSet()
    val width = if (sparse) size.width / SPARSE_COLUMNS else slot
    shown.forEach { index ->
        val label =
            measurer.measure(
                points[index].label,
                style,
                overflow = TextOverflow.Ellipsis,
                maxLines = 1,
                constraints = Constraints(maxWidth = max(width.toInt(), 1)),
            )
        val x = (centers[index] - label.size.width / 2f).coerceIn(0f, size.width - label.size.width)
        drawText(label, topLeft = Offset(x, baseline))
    }
}

internal data class ChartAxis(
    val top: Double,
    val step: Double,
) {
    /** 0'dan tepeye adım adım — etiketler hep adımın katı. */
    val ticks: List<Double> get() = (0..(top / step).roundToInt()).map { it * step }
}

/**
 * Y ekseni: ızgara adımı "yuvarlak" bir sayıya (1, 1,5, 2, 2,5, 3, 4, 5, 6, 8 × 10ⁿ) yükseltilir,
 * tepe o adımın katı. 62,5 → 0/40/80; 12 → 0/6/12. Sayımda adım en az 1 (1 → 0/1). Hepsi 0 ise
 * eksen 0–1.
 */
internal fun niceAxis(
    max: Double,
    integerValues: Boolean = false,
): ChartAxis {
    if (max <= 0.0) return ChartAxis(top = 1.0, step = if (integerValues) 1.0 else 0.5)
    val raw = max / TICK_COUNT
    val magnitude = 10.0.pow(floor(log10(raw)))
    val nice = NICE_STEPS.first { it * magnitude >= raw } * magnitude
    val step = if (integerValues) ceil(nice).coerceAtLeast(1.0) else nice
    return ChartAxis(top = ceil(max / step - EPSILON) * step, step = step)
}

private val PLOT_HEIGHT = 150.dp
private val GAP = 6.dp
private val GRID_STROKE = 1.dp
private val LINE_STROKE = 2.dp
private val DOT_RADIUS = 3.dp
private val DOT_MIN_SLOT = 10.dp
private val MIN_BAR = 2.dp
private val BAR_RADIUS = 3.dp
private const val BAR_FILL = 0.6f
private const val TICK_COUNT = 2
private const val EPSILON = 1e-9
private const val DENSE_LIMIT = 8
private const val SPARSE_COLUMNS = 3
private val NICE_STEPS = listOf(1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0)

@KlinaraPreviews
@Composable
private fun KlinaraChartPreview() {
    KlinaraTheme {
        KlinaraCard {
            KlinaraChart(
                kind = KlinaraChartKind.Bar,
                points =
                    listOf(
                        KlinaraChartPoint("1", "Derya Aksoy", 62.5),
                        KlinaraChartPoint("2", "Merve Tunç", 48.15),
                        KlinaraChartPoint("3", "Onur Bayrak", 12.0),
                    ),
                format = { "%${it.toInt()}" },
            )
        }
    }
}

@KlinaraPreviews
@Composable
private fun KlinaraChartLinePreview() {
    KlinaraTheme {
        KlinaraCard {
            KlinaraChart(
                kind = KlinaraChartKind.Line,
                points = (1..26).map { KlinaraChartPoint("$it", "2026-09-%02d".format(it), (it * 7 % 11) * 9.0) },
                format = { "%${it.toInt()}" },
            )
        }
    }
}
