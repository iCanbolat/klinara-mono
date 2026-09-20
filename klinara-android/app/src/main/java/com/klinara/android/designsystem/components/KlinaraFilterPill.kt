package com.klinara.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Yatay kaydırılan filtre satırlarının hapı — takvimde personel, müşterilerde etiket.
 * iOS `KlinaraFilterPill` paritesi: 34 dp kapsül, seçili hâlde koyu adaçayı dolgu.
 *
 * Dokunma hedefi yine 48 dp ([klinaraClickable]) ama zemin YALNIZ görünen hapa
 * boyanır; önceki çip zemini 48 dp tabana boyadığı için şişkin görünüyordu.
 */
@Composable
fun KlinaraFilterPill(
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    dotColor: Color? = null,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember { MutableInteractionSource() }

    Box(
        modifier =
            modifier
                .klinaraClickable(true, Role.Button, interaction, onClick)
                .clearAndSetSemantics {
                    contentDescription = label
                    selected = isSelected
                    role = Role.Button
                },
        contentAlignment = Alignment.Center,
    ) {
        Row(
            modifier =
                Modifier
                    .height(PILL_HEIGHT)
                    .background(if (isSelected) colors.sageDeep else colors.surfaceRaised, CircleShape)
                    .border(
                        KlinaraMetrics.borderWidth,
                        if (isSelected) colors.sageDeep else colors.border,
                        CircleShape,
                    ).padding(horizontal = PILL_HORIZONTAL_PADDING),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (dotColor != null) ColorDot(color = dotColor, size = DOT_SIZE)
            Text(
                text = label,
                style = KlinaraType.bodyM.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium),
                color = if (isSelected) colors.surfaceRaised else colors.charcoal,
                maxLines = 1,
            )
        }
    }
}

private val PILL_HEIGHT = 34.dp
private val PILL_HORIZONTAL_PADDING = 14.dp
private val DOT_SIZE = 8.dp
