package com.klinara.android.designsystem.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Marka metin alanı: UPPERCASE etiket + alan + hata satırı.
 *
 * Hata satırı **her zaman** yer kaplar ([FieldErrorText]): hata belirdiğinde altındaki
 * buton yer değiştirmez ve kullanıcı yanlış yere basmaz.
 */
@Composable
fun KlinaraTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    error: String? = null,
    isSecure: Boolean = false,
    enabled: Boolean = true,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    onSubmit: (() -> Unit)? = null,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    val hasError = !error.isNullOrEmpty()

    // rememberSaveable: döndürmede "parolayı göster" durumu korunur; parolanın
    // KENDİSİ değil, yalnız görünürlük bayrağı saklanır.
    var revealed by rememberSaveable { mutableStateOf(false) }

    val borderColor by animateColorAsState(
        targetValue =
            when {
                hasError -> colors.danger
                focused -> colors.borderFocus
                else -> colors.border
            },
        animationSpec = tween(KlinaraMetrics.FEEDBACK_MILLIS),
        label = "fieldBorder",
    )
    val borderWidth by animateDpAsState(
        targetValue =
            if (focused || hasError) KlinaraMetrics.focusBorderWidth else KlinaraMetrics.borderWidth,
        animationSpec = tween(KlinaraMetrics.FEEDBACK_MILLIS),
        label = "fieldBorderWidth",
    )

    val shape = RoundedCornerShape(KlinaraMetrics.controlRadius)
    val selectionColors =
        TextSelectionColors(handleColor = colors.sage, backgroundColor = colors.sageSoft)

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            KlinaraType.labelText(label),
            style = KlinaraType.label,
            color = colors.charcoalMuted,
            modifier = Modifier.padding(bottom = KlinaraMetrics.sm),
        )

        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = KlinaraMetrics.fieldHeight)
                    .clip(shape)
                    .background(if (enabled) colors.surfaceRaised else colors.disabled)
                    .border(borderWidth, borderColor, shape)
                    .padding(horizontal = KlinaraMetrics.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        ) {
            CompositionLocalProvider(LocalTextSelectionColors provides selectionColors) {
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    enabled = enabled,
                    singleLine = true,
                    textStyle = KlinaraType.bodyL.copy(color = colors.charcoal),
                    cursorBrush = SolidColor(colors.sage),
                    interactionSource = interactionSource,
                    keyboardOptions =
                        KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
                    keyboardActions =
                        KeyboardActions(
                            onDone = { onSubmit?.invoke() },
                            onGo = { onSubmit?.invoke() },
                            onNext = { onSubmit?.invoke() },
                        ),
                    visualTransformation =
                        if (isSecure && !revealed) {
                            PasswordVisualTransformation()
                        } else {
                            VisualTransformation.None
                        },
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.CenterStart) {
                            if (value.isEmpty() && placeholder.isNotEmpty()) {
                                Text(placeholder, style = KlinaraType.bodyL, color = colors.charcoalMuted)
                            }
                            inner()
                        }
                    },
                )
            }

            if (isSecure) {
                val revealInteraction = remember { MutableInteractionSource() }
                Icon(
                    imageVector = Icons.Filled.Lock,
                    contentDescription = if (revealed) "Parolayı gizle" else "Parolayı göster",
                    tint = if (revealed) colors.sage else colors.charcoalMuted,
                    modifier =
                        Modifier
                            .size(ICON_SIZE)
                            .klinaraClickable(
                                enabled = enabled,
                                role = Role.Switch,
                                interactionSource = revealInteraction,
                            ) { revealed = !revealed },
                )
            }
        }

        FieldErrorText(error)
    }
}

/**
 * Alan altındaki hata satırı. Metin yokken de yüksekliği korur — yoksa hata
 * belirdiğinde altındaki her şey aşağı kayar.
 */
@Composable
fun FieldErrorText(
    message: String?,
    modifier: Modifier = Modifier,
) {
    val visible = !message.isNullOrEmpty()
    Text(
        text = message ?: " ",
        style = KlinaraType.bodyM,
        color = if (visible) KlinaraTheme.colors.danger else androidx.compose.ui.graphics.Color.Transparent,
        modifier =
            modifier
                .fillMaxWidth()
                .padding(top = KlinaraMetrics.xs)
                .then(if (visible) Modifier else Modifier.clearAndSetSemantics {}),
    )
}

private val ICON_SIZE = 20.dp
