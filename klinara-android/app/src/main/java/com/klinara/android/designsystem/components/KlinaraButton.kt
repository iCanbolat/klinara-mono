package com.klinara.android.designsystem.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/**
 * Marka buton türleri.
 *
 * - [Primary]: dolu sage — ekranda **tek** birincil aksiyon olur.
 * - [Secondary]: kenarlıklı — eşdeğer ağırlıkta alternatif.
 * - [Tertiary]: düz metin — "vazgeç", "daha sonra", yardımcı yollar.
 * - [Destructive]: `danger` tonunda düz metin — "pasife al" gibi geri alması pahalı
 *   aksiyonlar. Marka yeşiliyle çizilen bir "Pasife al", kaydetmekle aynı ağırlıkta
 *   görünüyordu; iOS'taki `role: .destructive` karşılığı.
 */
enum class KlinaraButtonKind { Primary, Secondary, Tertiary, Destructive }

/**
 * Yükseklik SABİT DEĞİL (`defaultMinSize`): erişilebilirlik punto boylarında etiket
 * iki satıra taşar ve sabit yükseklikte kırpılırdı.
 *
 * Yükleniyor hâlinde içerik `alpha = 0` ile yerinde durur — buton yüksekliği değişmez,
 * altındaki düzen zıplamaz.
 */
@Composable
fun KlinaraButton(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: KlinaraButtonKind = KlinaraButtonKind.Primary,
    icon: ImageVector? = null,
    isLoading: Boolean = false,
    enabled: Boolean = true,
) {
    val colors = KlinaraTheme.colors
    val interactive = enabled && !isLoading
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()

    // Basıldığında hafifçe söner. Ölçek animasyonu YOK — marka kişiliği sakin.
    val pressAlpha by animateFloatAsState(
        targetValue = if (pressed && interactive) KlinaraMetrics.PRESSED_ALPHA else 1f,
        animationSpec = tween(PRESS_FADE_MILLIS),
        label = "pressAlpha",
    )

    val palette = buttonPalette(kind, enabled)
    val fill by animateColorAsState(
        targetValue = palette.fill,
        animationSpec = tween(KlinaraMetrics.FEEDBACK_MILLIS),
        label = "buttonFill",
    )

    val shape = RoundedCornerShape(KlinaraMetrics.controlRadius)
    val minHeight =
        if (kind == KlinaraButtonKind.Tertiary) KlinaraMetrics.minTouchTarget else KlinaraMetrics.controlHeight

    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = minHeight)
                .alpha(pressAlpha)
                .clip(shape)
                .background(fill)
                .then(
                    if (kind == KlinaraButtonKind.Secondary) {
                        Modifier.border(
                            BorderStroke(
                                KlinaraMetrics.borderWidth,
                                if (enabled) colors.border else colors.disabled,
                            ),
                            shape,
                        )
                    } else {
                        Modifier
                    },
                )
                .klinaraClickable(
                    enabled = interactive,
                    role = Role.Button,
                    interactionSource = interactionSource,
                    onClick = onClick,
                )
                .padding(vertical = KlinaraMetrics.xs, horizontal = KlinaraMetrics.sm),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.alpha(if (isLoading) 0f else 1f),
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = palette.content, modifier = Modifier.size(ICON_SIZE))
            }
            Text(
                text = title,
                style = KlinaraType.button,
                color = palette.content,
                textAlign = TextAlign.Center,
            )
        }

        if (isLoading) {
            CircularProgressIndicator(
                modifier = Modifier.size(SPINNER_SIZE),
                color = palette.spinner,
                strokeWidth = SPINNER_STROKE,
            )
        }
    }
}

/** Buton türü ve etkinlik durumundan renkleri çözer — üç `when` çağrı yerinden çıkar. */
@Immutable
private data class ButtonPalette(val fill: Color, val content: Color, val spinner: Color)

@Composable
private fun buttonPalette(
    kind: KlinaraButtonKind,
    enabled: Boolean,
): ButtonPalette {
    val colors = KlinaraTheme.colors
    return ButtonPalette(
        fill =
            when (kind) {
                KlinaraButtonKind.Primary -> if (enabled) colors.sage else colors.disabled
                KlinaraButtonKind.Secondary -> colors.surfaceRaised
                KlinaraButtonKind.Tertiary, KlinaraButtonKind.Destructive -> Color.Transparent
            },
        content =
            when {
                !enabled -> colors.charcoalMuted
                kind == KlinaraButtonKind.Primary -> colors.surfaceRaised
                kind == KlinaraButtonKind.Secondary -> colors.charcoal
                kind == KlinaraButtonKind.Destructive -> colors.danger
                else -> colors.sageDeep
            },
        spinner = if (kind == KlinaraButtonKind.Primary) colors.surfaceRaised else colors.sage,
    )
}

private const val PRESS_FADE_MILLIS = 120
private val ICON_SIZE = 20.dp
private val SPINNER_SIZE = 20.dp
private val SPINNER_STROKE = 2.dp
