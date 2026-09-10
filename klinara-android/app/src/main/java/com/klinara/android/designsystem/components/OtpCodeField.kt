package com.klinara.android.designsystem.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Doğrulama kodu alanı: görünürde [digitCount] kutu, altında **tek** gizli metin alanı.
 *
 * Kutu başına ayrı `TextField` kullanmak SMS otomatik doldurmayı ve yapıştırmayı bozar;
 * ekran okuyucu da altı ayrı alan duyurur. Tek alan + görsel kutular hem TalkBack'te
 * tek bir "Doğrulama kodu, 6 hane" duyurusu verir hem `KeyboardType.NumberPassword`
 * ile SMS önerisini alır.
 */
@Composable
fun OtpCodeField(
    code: String,
    onCodeChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    digitCount: Int = 6,
    hasError: Boolean = false,
    enabled: Boolean = true,
    onComplete: ((String) -> Unit)? = null,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    val focusRequester = remember { FocusRequester() }

    BasicTextField(
        value = code,
        onValueChange = { typed ->
            val filtered = typed.filter { it.isDigit() }.take(digitCount)
            if (filtered != code) {
                onCodeChange(filtered)
                if (filtered.length == digitCount) onComplete?.invoke(filtered)
            }
        },
        enabled = enabled,
        singleLine = true,
        cursorBrush = SolidColor(Color.Transparent),
        interactionSource = interactionSource,
        keyboardOptions =
            KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
        modifier =
            modifier
                .fillMaxWidth()
                .focusRequester(focusRequester)
                .semantics { contentDescription = "Doğrulama kodu, $digitCount hane" },
        decorationBox = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            ) {
                repeat(digitCount) { index ->
                    DigitBox(
                        character = code.getOrNull(index)?.toString().orEmpty(),
                        isActive = focused && index == code.length.coerceAtMost(digitCount - 1),
                        hasError = hasError,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        },
    )
}

@Composable
private fun DigitBox(
    character: String,
    isActive: Boolean,
    hasError: Boolean,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    val borderColor by animateColorAsState(
        targetValue =
            when {
                hasError -> colors.danger
                isActive -> colors.borderFocus
                character.isEmpty() -> colors.border
                else -> colors.sage.copy(alpha = FILLED_BORDER_ALPHA)
            },
        animationSpec = tween(KlinaraMetrics.FEEDBACK_MILLIS),
        label = "digitBorder",
    )
    val borderWidth =
        if (isActive || hasError) KlinaraMetrics.focusBorderWidth else KlinaraMetrics.borderWidth
    val shape = RoundedCornerShape(KlinaraMetrics.controlRadius)

    Box(
        modifier =
            modifier
                .height(BOX_HEIGHT)
                .clip(shape)
                .background(colors.surfaceRaised)
                .border(borderWidth, borderColor, shape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = character,
            style = KlinaraType.code,
            color = colors.charcoal,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = KlinaraMetrics.xs),
        )
    }
}

private val BOX_HEIGHT = 60.dp
private const val FILLED_BORDER_ALPHA = 0.5f
