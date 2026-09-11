package com.klinara.android.designsystem.components

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Rapor dönemi çubuğu: önceki / etiket / sonraki (A5.4).
 *
 * Etiket çağırandan gelir ve **kapsayıcı** yazılır ("1 Eyl – 30 Eyl"); sunucuya giden üst
 * sınır ise hariçtir (1 Eki). Bu çevirinin tek yerde yapılması çağıranın işi — bileşen
 * tarih bilmez, yalnız yön bildirir.
 */
@Composable
fun ReportPeriodBar(
    label: String,
    onShift: (months: Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    Row(modifier = modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        ShiftButton(
            icon = { Arrow(Icons.AutoMirrored.Filled.KeyboardArrowLeft) },
            description = "Önceki dönem",
            onClick = { onShift(-1) },
        )
        Text(
            label,
            style = KlinaraType.bodyEmphasis,
            color = colors.charcoal,
            textAlign = TextAlign.Center,
            modifier = Modifier.weight(1f),
        )
        ShiftButton(
            icon = { Arrow(Icons.AutoMirrored.Filled.KeyboardArrowRight) },
            description = "Sonraki dönem",
            onClick = { onShift(1) },
        )
    }
}

@Composable
private fun Arrow(icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Icon(icon, contentDescription = null, tint = KlinaraTheme.colors.sageDeep)
}

@Composable
private fun ShiftButton(
    icon: @Composable () -> Unit,
    description: String,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier =
            Modifier
                .klinaraClickable(true, Role.Button, interaction, onClick)
                .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(ICON_BOX), contentAlignment = Alignment.Center) { icon() }
    }
}

private val ICON_BOX = 32.dp
