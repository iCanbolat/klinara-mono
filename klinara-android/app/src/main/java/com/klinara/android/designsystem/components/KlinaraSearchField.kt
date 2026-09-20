package com.klinara.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Liste ekranlarının arama alanı — iOS `.searchable` paritesi.
 *
 * `KlinaraTextField`ten AYRI: o bir form alanı (büyük harf etiket, hata metni, 52 dp);
 * listenin üstündeki arama ise etiketsiz, büyüteçli ve kısa bir kapsül.
 */
@Composable
fun KlinaraSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    val shape = RoundedCornerShape(KlinaraMetrics.controlRadius)

    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .height(FIELD_HEIGHT)
                .background(colors.surfaceRaised, shape)
                .border(KlinaraMetrics.borderWidth, colors.border, shape)
                .padding(start = KlinaraMetrics.md - KlinaraMetrics.xs, end = KlinaraMetrics.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        Icon(
            Icons.Filled.Search,
            contentDescription = null,
            tint = colors.charcoalMuted,
            modifier = Modifier.size(20.dp),
        )
        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) {
                Text(placeholder, style = KlinaraType.bodyM, color = colors.charcoalMuted, maxLines = 1)
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = KlinaraType.bodyM.copy(color = colors.charcoal),
                cursorBrush = SolidColor(colors.sageDeep),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = placeholder },
            )
        }
        if (value.isNotEmpty()) {
            val interaction = remember { MutableInteractionSource() }
            Box(
                modifier =
                    Modifier
                        .size(KlinaraMetrics.minTouchTarget)
                        .klinaraClickable(true, Role.Button, interaction) { onValueChange("") },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Clear,
                    contentDescription = "Aramayı temizle",
                    tint = colors.charcoalMuted,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

private val FIELD_HEIGHT = 44.dp
