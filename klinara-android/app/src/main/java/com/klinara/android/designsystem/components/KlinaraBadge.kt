package com.klinara.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.badgeMutedSurface
import com.klinara.android.designsystem.badgeNeutralSurface
import com.klinara.android.designsystem.warningSurface

/** Durum rozeti tonu. Renk taşır, anlam taşımaz — anlamı çağıran verir. */
enum class KlinaraBadgeTone { Neutral, Positive, Warning, Muted }

/**
 * Kapsül durum rozeti.
 *
 * Renk **tek başına** bilgi taşımaz (WCAG 1.4.1): metin her zaman var ve rozet
 * ekran okuyucuya kendi metniyle duyuruluyor.
 */
@Composable
fun KlinaraBadge(
    text: String,
    modifier: Modifier = Modifier,
    tone: KlinaraBadgeTone = KlinaraBadgeTone.Neutral,
    icon: ImageVector? = null,
) {
    val colors = KlinaraTheme.colors
    val foreground =
        when (tone) {
            KlinaraBadgeTone.Neutral -> colors.charcoal
            KlinaraBadgeTone.Positive -> colors.sageDeep
            KlinaraBadgeTone.Warning -> colors.danger
            KlinaraBadgeTone.Muted -> colors.charcoalMuted
        }
    val background =
        when (tone) {
            KlinaraBadgeTone.Neutral -> colors.badgeNeutralSurface
            KlinaraBadgeTone.Positive -> colors.sageSoft
            KlinaraBadgeTone.Warning -> colors.warningSurface
            KlinaraBadgeTone.Muted -> colors.badgeMutedSurface
        }

    Row(
        modifier =
            modifier
                .background(background, CircleShape)
                .padding(horizontal = KlinaraMetrics.sm, vertical = VERTICAL_PADDING),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = foreground, modifier = Modifier.size(ICON_SIZE))
        }
        Text(text, style = KlinaraType.label.copy(fontSize = BADGE_FONT_SIZE), color = foreground)
    }
}

/** Renkli nokta — takvim renk kodu. Yanında daima bir metin bulunur. */
@Composable
fun ColorDot(
    color: Color,
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = DOT_SIZE,
) {
    androidx.compose.foundation.layout.Box(
        modifier.size(size).background(color, CircleShape),
    )
}

private val VERTICAL_PADDING = 3.dp
private val ICON_SIZE = 12.dp
private val DOT_SIZE = 10.dp
private val BADGE_FONT_SIZE = androidx.compose.ui.unit.TextUnit(11f, androidx.compose.ui.unit.TextUnitType.Sp)
