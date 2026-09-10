package com.klinara.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Takvim ızgarasının ölçüleri.
 *
 * `KlinaraMetrics`'e KONMADI: bunlar marka token'ı değil, tek bir ekranın geometrisi.
 * 4pt ızgarasına uymayan tek yer burası ve sebebi saat başına 64 dp'nin dakika
 * çözünürlüğünü okunur tutması — token tablosuna girseler, her ekranın kullanabileceği
 * bir ölçü gibi görünürlerdi.
 *
 * Dikey ölçüler (saat yüksekliği, minimum blok) [com.klinara.android.features.calendar.CalendarBlockLayout]'ta
 * yaşıyor çünkü orası Compose'suz ve test edilebilir olmak zorunda; burası yalnız
 * onları `Dp`'ye çevirir.
 */
object CalendarGridMetrics {
    /** Gün ızgarasının saat cetveli. Hafta ızgarası daha dar bir cetvel kullanır. */
    val dayRulerWidth: Dp = 52.dp

    /** Hafta cetveli: tam genişlik saat çizgisi taşımadığı için daha dar olabiliyor. */
    val weekRulerWidth: Dp = 44.dp

    val columnSpacing: Dp = 2.dp
}

/**
 * Sol saat cetveli.
 *
 * Her satırın üstünde bir ayraç çizgisi var; bunlar ızgaranın yatay çizgileridir ve
 * cetvelle aynı bileşende durur ki saat etiketi ile çizgisi asla kaymasın.
 */
@Composable
fun TimeAxisRuler(
    hours: IntRange,
    hourHeight: Dp,
    modifier: Modifier = Modifier,
    rulerWidth: Dp = CalendarGridMetrics.dayRulerWidth,
    drawFullWidthRules: Boolean = true,
) {
    val colors = KlinaraTheme.colors
    Column(modifier = modifier.fillMaxWidth()) {
        hours.forEach { hour ->
            Box(modifier = Modifier.fillMaxWidth().height(hourHeight)) {
                if (drawFullWidthRules) {
                    Box(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .height(KlinaraMetrics.borderWidth)
                                .background(colors.border),
                    )
                }
                Text(
                    text = "%02d:00".format(hour),
                    style = KlinaraType.label,
                    color = colors.charcoalMuted,
                    modifier =
                        Modifier
                            .width(rulerWidth)
                            .padding(top = LABEL_TOP_INSET, start = KlinaraMetrics.xs),
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * Şimdiki zaman göstergesi. Yalnız bugünde çizilir.
 *
 * **Kendi kendine tazelenmez** (iOS'ta da öyle): bir dakikalık `LaunchedEffect`
 * saatiyle bir takvim ekranı boyunca recomposition tetiklemek, kazandırdığı hassasiyeti
 * pil ve kaydırma akıcılığıyla öderdi. Ekran her açılışta ve her yeniden yüklemede
 * doğru konumda çizilir.
 */
@Composable
fun NowIndicator(modifier: Modifier = Modifier) {
    val colors = KlinaraTheme.colors
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.size(NOW_DOT_SIZE).background(colors.danger, CircleShape))
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(NOW_RULE_HEIGHT)
                    .background(colors.danger),
        )
    }
}

/**
 * Gün ızgarasındaki randevu bloğu.
 *
 * Sol kenardaki 3 dp'lik şerit personelin rengi. Renk **tek başına** bilgi taşımaz
 * (WCAG 1.4.1): müşteri adı, saat ve durum metin olarak da orada.
 */
@Composable
fun AppointmentBlockView(
    title: String,
    subtitle: String,
    timeRange: String,
    accent: Color,
    isTerminal: Boolean,
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(BLOCK_RADIUS)

    Row(
        modifier =
            modifier
                // Kapanmış blok tam genişlikte çizilir (sütun rezerve etmediği için) ve
                // bu, onu aktif bloklardan daha BASKIN gösterme riski taşır. Bütünsel
                // soluklaştırma o riski kapatır: iptal edilmiş bir randevu görünür
                // kalmalı ama günün asıl işini bastırmamalı.
                .alpha(if (isTerminal) TERMINAL_ALPHA else 1f)
                .clip(shape)
                .background(accent.copy(alpha = if (isTerminal) TERMINAL_FILL_ALPHA else ACTIVE_FILL_ALPHA))
                .klinaraClickable(
                    enabled = true,
                    role = Role.Button,
                    interactionSource = interaction,
                    onClick = onClick,
                ).clearAndSetSemantics { this.contentDescription = contentDescription },
    ) {
        Box(modifier = Modifier.width(ACCENT_STRIPE).fillMaxHeight().background(accent))

        Column(
            modifier = Modifier.padding(horizontal = KlinaraMetrics.xs, vertical = BLOCK_VERTICAL_PADDING),
        ) {
            Text(
                text = title,
                style = KlinaraType.bodyEmphasis,
                color = if (isTerminal) colors.charcoalMuted else colors.charcoal,
                textDecoration = if (isTerminal) TextDecoration.LineThrough else null,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "$timeRange · $subtitle",
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * Hafta ızgarasının dar bloğu.
 *
 * Başlık **yalnız blok yeterince yüksekse** çizilir: 30 dakikalık bir bloğa sıkıştırılan
 * 9sp metin okunmuyor, yalnız gürültü ekliyordu. Bilgi kaybolmuyor — tam metin
 * [contentDescription]'da ve bloğa dokunmak detayı açıyor.
 */
@Composable
fun WeekBlockView(
    title: String,
    accent: Color,
    isTerminal: Boolean,
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(WEEK_BLOCK_RADIUS)

    BoxWithConstraints(
        modifier =
            modifier
                .alpha(if (isTerminal) TERMINAL_ALPHA else 1f)
                .clip(shape)
                .background(accent.copy(alpha = if (isTerminal) WEEK_TERMINAL_FILL else WEEK_ACTIVE_FILL))
                .klinaraClickable(
                    enabled = true,
                    role = Role.Button,
                    interactionSource = interaction,
                    onClick = onClick,
                ).clearAndSetSemantics { this.contentDescription = contentDescription },
    ) {
        Box(modifier = Modifier.width(WEEK_ACCENT_STRIPE).fillMaxHeight().background(accent))

        if (maxHeight >= WEEK_TITLE_MIN_HEIGHT) {
            Text(
                text = title,
                style = KlinaraType.label,
                color = KlinaraTheme.colors.charcoal,
                textDecoration = if (isTerminal) TextDecoration.LineThrough else null,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = WEEK_TITLE_INSET, end = 1.dp, top = 1.dp),
            )
        }
    }
}

private val ACCENT_STRIPE = 3.dp
private val WEEK_ACCENT_STRIPE = 2.dp
private val WEEK_BLOCK_RADIUS = 4.dp
private val WEEK_TITLE_INSET = 4.dp
private val WEEK_TITLE_MIN_HEIGHT = 24.dp
private const val WEEK_ACTIVE_FILL = 0.22f
private const val WEEK_TERMINAL_FILL = 0.08f
private val BLOCK_RADIUS = 6.dp
private val BLOCK_VERTICAL_PADDING = 3.dp
private val NOW_DOT_SIZE = 7.dp
private val NOW_RULE_HEIGHT = 1.5.dp
private val LABEL_TOP_INSET = 2.dp
private const val ACTIVE_FILL_ALPHA = 0.14f
private const val TERMINAL_FILL_ALPHA = 0.05f
private const val TERMINAL_ALPHA = 0.6f
