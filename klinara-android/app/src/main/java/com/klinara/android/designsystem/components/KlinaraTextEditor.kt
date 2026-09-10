package com.klinara.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Çok satırlı metin alanı.
 *
 * **A0.3'ten A4.3'e ertelenmişti** ve gerekçesi buydu: tek satırlık `KlinaraTextField`
 * ile aynı görünen ama farklı davranan bir bileşenin şekli, gerçek bir çağıran
 * olmadan kararlaştırılamazdı. Çağıran not editöründe doğdu.
 *
 * `KlinaraTextField`ten farkı yalnız `maxLines` değil: **`ImeAction.Default`** taşıyor
 * (Enter satır atlar, formu göndermez) ve minimum yüksekliği var — klinik bir not
 * çoğunlukla birkaç cümledir ve tek satırlık bir kutu, kullanıcıyı yazdığını
 * göremeden yazmaya zorlar.
 */
@Composable
fun KlinaraTextEditor(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    error: String? = null,
    enabled: Boolean = true,
    minHeight: androidx.compose.ui.unit.Dp = DEFAULT_MIN_HEIGHT,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    val shape = RoundedCornerShape(KlinaraMetrics.controlRadius)

    val borderColor =
        when {
            error != null -> colors.danger
            focused -> colors.borderFocus
            else -> colors.border
        }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        Text(text = label.uppercase(), style = KlinaraType.label, color = colors.charcoalMuted)

        CompositionLocalProvider(
            LocalTextSelectionColors provides
                TextSelectionColors(handleColor = colors.sage, backgroundColor = colors.sageSoft),
        ) {
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                textStyle = KlinaraType.bodyM.copy(color = if (enabled) colors.charcoal else colors.charcoalMuted),
                cursorBrush = SolidColor(colors.sage),
                interactionSource = interactionSource,
                // Enter SATIR ATLAR: çok satırlı bir alanda "gönder" davranışı,
                // kullanıcının paragraf yazmasını imkânsız kılardı.
                keyboardOptions =
                    androidx.compose.foundation.text.KeyboardOptions(imeAction = ImeAction.Default),
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = minHeight)
                        .background(if (enabled) colors.surfaceRaised else colors.disabled, shape)
                        .border(
                            width = if (focused) KlinaraMetrics.focusBorderWidth else KlinaraMetrics.borderWidth,
                            color = borderColor,
                            shape = shape,
                        ).padding(KlinaraMetrics.md)
                        .semantics { },
                decorationBox = { inner ->
                    if (value.isEmpty() && placeholder.isNotEmpty()) {
                        Text(placeholder, style = KlinaraType.bodyM, color = colors.charcoalMuted)
                    }
                    inner()
                },
            )
        }

        error?.let {
            Text(text = it, style = KlinaraType.bodyM, color = colors.danger)
        }
    }
}

private val DEFAULT_MIN_HEIGHT = 120.dp
