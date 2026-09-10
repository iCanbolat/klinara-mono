package com.klinara.android.designsystem.components

import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Etiket + detay + `−`/`+` adımlayıcı.
 *
 * A5.1'de paket kalemi adedi için doğdu; A5.3'te iade/devir/düzeltme adetleri de
 * bununla. **Aralık dışına çıkan adım HİÇ sunulmaz** (düğme pasifleşir): kalan hakkı
 * eksiye düşürecek bir `−`, basılabilen ama daima 409 dönen bir kontrol olurdu.
 *
 * `material-icons-core` setinde "eksi" ikonu yok; `−`/`+` metin olarak çiziliyor ve
 * ekran okuyucuya "azalt"/"artır" diye duyuruluyor. Bir adımlayıcı uğruna
 * `material-icons-extended` eklemek §7.7'nin reddettiği türden bir bağımlılık.
 */
@Composable
fun KlinaraStepperRow(
    label: String,
    value: Int,
    onValueChange: (Int) -> Unit,
    range: IntRange,
    modifier: Modifier = Modifier,
    detail: String? = null,
    enabled: Boolean = true,
    format: (Int) -> String = { it.toString() },
) {
    val colors = KlinaraTheme.colors
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = KlinaraMetrics.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, style = KlinaraType.bodyEmphasis, color = colors.charcoal)
            detail?.let { Text(it, style = KlinaraType.bodyM, color = colors.charcoalMuted) }
        }

        StepButton(
            glyph = "−",
            description = "$label azalt",
            enabled = enabled && value - 1 >= range.first,
            onClick = { onValueChange(value - 1) },
        )
        Text(
            format(value),
            style = KlinaraType.bodyEmphasis,
            color = colors.charcoal,
            textAlign = TextAlign.Center,
            modifier =
                Modifier.widthIn(min = VALUE_MIN_WIDTH).semantics {
                    contentDescription = label
                    stateDescription = format(value)
                },
        )
        StepButton(
            glyph = "+",
            description = "$label artır",
            enabled = enabled && value + 1 <= range.last,
            onClick = { onValueChange(value + 1) },
        )
    }
}

@Composable
private fun StepButton(
    glyph: String,
    description: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier =
            Modifier
                .klinaraClickable(enabled, Role.Button, interaction, onClick)
                .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier =
                Modifier
                    .size(BUTTON_SIZE)
                    .border(KlinaraMetrics.borderWidth, if (enabled) colors.border else colors.disabled, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                glyph,
                style = KlinaraType.button,
                color = if (enabled) colors.sageDeep else colors.charcoalMuted,
            )
        }
    }
}

private val BUTTON_SIZE = 36.dp
private val VALUE_MIN_WIDTH = 56.dp
