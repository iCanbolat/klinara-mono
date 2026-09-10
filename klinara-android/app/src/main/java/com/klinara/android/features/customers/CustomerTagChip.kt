package com.klinara.android.features.customers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.services.crm.CustomerTag

/**
 * Etiket rozeti.
 *
 * `KlinaraBadge` kullanılmadı çünkü o **sabit bir ton kümesi** taşıyor (Neutral,
 * Positive, Warning…) ve etiketin rengi kiracının seçtiği serbest bir hex. Ton
 * enum'una "AnyColor" eklemek, tasarım sisteminin sözünü bozardı.
 */
@Composable
fun CustomerTagChip(
    tag: CustomerTag,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    // Bozuk ya da eksik renk NÖTR tona düşer, çökmez: bir etiket rengi bir ekranı
    // düşürecek kadar önemli değil.
    val accent = parseHexColor(tag.color) ?: colors.charcoalMuted

    Text(
        text = tag.name,
        style = KlinaraType.label,
        color = accent,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier =
            modifier
                .background(accent.copy(alpha = CHIP_BACKGROUND_ALPHA), RoundedCornerShape(CHIP_RADIUS))
                .padding(horizontal = KlinaraMetrics.sm, vertical = CHIP_VERTICAL_PADDING),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CustomerTagRow(
    tags: List<CustomerTag>,
    modifier: Modifier = Modifier,
) {
    if (tags.isEmpty()) return
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        tags.forEach { CustomerTagChip(it) }
    }
}

/** `#RRGGBB` → [Color]; başka her şey `null`. Sunucu biçimi doğruluyor ama mock ve eski kayıtlar sapabilir. */
internal fun parseHexColor(value: String?): Color? {
    val hex = value?.trim()?.removePrefix("#") ?: return null
    if (hex.length != HEX_LENGTH || !hex.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) return null
    return runCatching { Color(hex.toLong(HEX_RADIX) or OPAQUE_ALPHA) }.getOrNull()
}

private const val HEX_LENGTH = 6
private const val HEX_RADIX = 16
private const val OPAQUE_ALPHA = 0xFF000000L
private const val CHIP_BACKGROUND_ALPHA = 0.14f
private val CHIP_RADIUS = 8.dp
private val CHIP_VERTICAL_PADDING = 2.dp
