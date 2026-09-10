package com.klinara.android.features.customers

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.klinaraClickable

/**
 * Seçilebilir çip — etiket ve geliş kaynağı seçicileri için.
 *
 * `CustomerTagChip`ten AYRI: o bir **gösterim** rozeti (tıklanmaz, seçili hâli yok),
 * bu bir **kontrol**. İkisini tek bileşende toplamak, salt okunur bir rozete tıklama
 * semantiği ve TalkBack'e yanlış bir rol vermek olurdu.
 */
@Composable
fun SelectableChip(
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    accent: Color? = null,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val tint = accent ?: colors.sage

    Text(
        text = label,
        style = KlinaraType.bodyM,
        color = if (isSelected) colors.surfaceRaised else colors.charcoal,
        modifier =
            modifier
                .semantics { selected = isSelected }
                .background(
                    color = if (isSelected) tint else colors.surfaceRaised,
                    shape = RoundedCornerShape(CHIP_RADIUS),
                ).border(
                    width = KlinaraMetrics.borderWidth,
                    color = if (isSelected) tint else colors.border,
                    shape = RoundedCornerShape(CHIP_RADIUS),
                ).klinaraClickable(true, Role.Checkbox, interactionSource, onClick)
                .padding(horizontal = KlinaraMetrics.md, vertical = KlinaraMetrics.sm),
    )
}

private val CHIP_RADIUS = 10.dp
