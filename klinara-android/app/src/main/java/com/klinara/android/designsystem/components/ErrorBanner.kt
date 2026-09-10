package com.klinara.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.dangerBorder
import com.klinara.android.designsystem.dangerSurface
import com.klinara.android.designsystem.overlayScrim

/**
 * Ekran düzeyi hata afişi.
 *
 * `liveRegion = Polite`: TalkBack hatayı belirdiği anda duyurur. Görme engelli bir
 * kullanıcı ekranın ortasında beliren bir metni yoksa hiç fark etmez.
 *
 * Destek referansı yalnız sunucu tarafı hatalarda (`INTERNAL_ERROR` ailesi) gösterilir;
 * kullanıcı hatalarında bir vaka numarası vermek yardım değil, gürültüdür.
 */
@Composable
fun ErrorBanner(
    message: String,
    modifier: Modifier = Modifier,
    supportReference: String? = null,
    retryLabel: String = "Tekrar dene",
    onRetry: (() -> Unit)? = null,
) {
    val colors = KlinaraTheme.colors
    val shape = RoundedCornerShape(KlinaraMetrics.controlRadius)
    val retryInteraction = remember { MutableInteractionSource() }

    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(shape)
                .background(colors.dangerSurface)
                .border(KlinaraMetrics.borderWidth, colors.dangerBorder, shape)
                .padding(KlinaraMetrics.md)
                .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            Icons.Filled.Warning,
            contentDescription = null,
            tint = colors.danger,
            modifier = Modifier.size(ICON_SIZE),
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            Text(message, style = KlinaraType.bodyM, color = colors.charcoal)

            if (supportReference != null) {
                Text(
                    "Destek referansı: $supportReference",
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                )
            }

            if (onRetry != null) {
                Text(
                    retryLabel,
                    style = KlinaraType.bodyEmphasis,
                    color = colors.sageDeep,
                    modifier =
                        Modifier
                            .klinaraClickable(
                                enabled = true,
                                role = Role.Button,
                                interactionSource = retryInteraction,
                                onClick = onRetry,
                            ),
                )
            }
        }
    }
}

/**
 * Bloke edici yükleme örtüsü. Arkasındaki içerik görünür kalır (yarı saydam) ama
 * dokunulamaz — kullanıcı ne olduğunu görür, iki kez göndermez.
 */
@Composable
fun AuthLoadingOverlay(
    message: String,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    val blocker = remember { MutableInteractionSource() }

    Box(
        modifier =
            modifier
                .fillMaxSize()
                .background(colors.overlayScrim)
                // Altındaki her şeyi yutar: çift gönderim yok.
                .klinaraClickable(enabled = true, role = Role.Button, interactionSource = blocker) {}
                .semantics { liveRegion = LiveRegionMode.Polite },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
        ) {
            CircularProgressIndicator(color = colors.sage, strokeWidth = SPINNER_STROKE)
            Text(message, style = KlinaraType.bodyM, color = colors.charcoalMuted)
        }
    }
}

private val ICON_SIZE = 20.dp
private val SPINNER_STROKE = 2.dp
