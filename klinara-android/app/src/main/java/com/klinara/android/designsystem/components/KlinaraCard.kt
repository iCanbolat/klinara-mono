package com.klinara.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.annotation.DrawableRes
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/** Kart kabı: yükseltilmiş zemin, 1dp kenarlık, 16dp yarıçap. */
@Composable
fun KlinaraCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    footnote: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = KlinaraTheme.colors
    val shape = RoundedCornerShape(KlinaraMetrics.cardRadius)

    Column(modifier = modifier.fillMaxWidth()) {
        if (title != null) {
            Text(
                KlinaraType.labelText(title),
                style = KlinaraType.label,
                color = colors.charcoalMuted,
                modifier = Modifier.padding(bottom = KlinaraMetrics.sm, start = KlinaraMetrics.xs),
            )
        }

        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clip(shape)
                    .background(colors.surfaceRaised)
                    .border(KlinaraMetrics.borderWidth, colors.border, shape)
                    .padding(KlinaraMetrics.md),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            content = content,
        )

        if (footnote != null) {
            Text(
                footnote,
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
                modifier = Modifier.padding(top = KlinaraMetrics.sm, start = KlinaraMetrics.xs),
            )
        }
    }
}

/** 1dp ayraç, 16dp baş girintili. */
@Composable
fun KlinaraDivider(modifier: Modifier = Modifier) {
    androidx.compose.foundation.layout.Box(
        modifier
            .fillMaxWidth()
            .padding(start = KlinaraMetrics.md)
            .height(KlinaraMetrics.borderWidth)
            .background(KlinaraTheme.colors.border),
    )
}

/** Etiket + değer satırı. Aksesuar yuvası boş bırakılabilir. */
@Composable
fun KlinaraRow(
    label: String,
    modifier: Modifier = Modifier,
    value: String? = null,
    detail: String? = null,
    accessory: @Composable (RowScope.() -> Unit)? = null,
) {
    val colors = KlinaraTheme.colors
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = KlinaraMetrics.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, style = KlinaraType.bodyM, color = colors.charcoalMuted)
            if (value != null) {
                Text(value, style = KlinaraType.bodyL, color = colors.charcoal)
            }
            if (detail != null) {
                Text(detail, style = KlinaraType.bodyM, color = colors.charcoalMuted)
            }
        }
        accessory?.invoke(this)
    }
}

/**
 * Tıklanabilir satır — bir sonraki ekrana götürür.
 *
 * [icon] iOS `KlinaraNavigationRow`'un `icon:` parametresinin karşılığı: baştaki 24dp'lik
 * sabit yuvada, `sageDeep` tonunda bir sembol. Null geçen çağıranlar (liste satırları)
 * bugünkü görünümü aynen korur — ikon yalnız hub satırlarının işine yarar.
 */
@Composable
fun KlinaraNavigationRow(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    value: String? = null,
    detail: String? = null,
    enabled: Boolean = true,
    @DrawableRes icon: Int? = null,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }

    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(KlinaraMetrics.controlRadius))
                .klinaraClickable(enabled, Role.Button, interactionSource, onClick)
                .padding(vertical = KlinaraMetrics.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
    ) {
        if (icon != null) {
            Icon(
                painter = painterResource(icon),
                contentDescription = null,
                tint = if (enabled) colors.sageDeep else colors.charcoalMuted,
                modifier = Modifier.size(ROW_ICON_SIZE),
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                label,
                style = KlinaraType.bodyL,
                color = if (enabled) colors.charcoal else colors.charcoalMuted,
            )
            if (value != null) {
                Text(value, style = KlinaraType.bodyM, color = colors.charcoalMuted)
            }
            if (detail != null) {
                Text(detail, style = KlinaraType.bodyM, color = colors.charcoalMuted)
            }
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = colors.charcoalMuted,
            modifier = Modifier.size(CHEVRON_SIZE),
        )
    }
}

private val CHEVRON_SIZE = 20.dp
private val ROW_ICON_SIZE = 22.dp
