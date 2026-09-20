package com.klinara.android.designsystem.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.klinara.android.designsystem.KlinaraType
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme

/**
 * Ekranın birincil "oluştur" aksiyonu — sağ altta, alt gezinme çubuğunun üstünde.
 *
 * İçerikte tam genişlik bir "Yeni …" düğmesi listeyi aşağı itiyor ve her ekranda farklı
 * bir yerde duruyordu; FAB hem iOS hem Android'de aynı yerde, başparmak erişiminde.
 */
@Composable
fun KlinaraFab(
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.Filled.Add,
) {
    val colors = KlinaraTheme.colors
    FloatingActionButton(
        onClick = onClick,
        modifier = modifier.size(FAB_SIZE),
        shape = CircleShape,
        containerColor = colors.sageDeep,
        contentColor = colors.surfaceRaised,
        elevation = FloatingActionButtonDefaults.elevation(defaultElevation = 4.dp, pressedElevation = 2.dp),
    ) {
        Icon(icon, contentDescription = contentDescription)
    }
}

/**
 * İçeriği ve (varsa) FAB'ı üst üste yerleştirir. [fab] null ise yalnız içerik çizilir —
 * izni olmayan kullanıcıya dokunulduğunda 403 veren bir düğme gösterilmez (§7.4).
 */
@Composable
fun KlinaraFabBox(
    fab: (@Composable BoxScope.() -> Unit)?,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(modifier = modifier.fillMaxSize()) {
        content()
        if (fab != null) {
            Box(
                modifier = Modifier.align(Alignment.BottomEnd).padding(KlinaraMetrics.md),
                content = fab,
            )
        }
    }
}

/** FAB'ın altında kalmaması için kaydırılan içeriğin sonuna eklenecek boşluk. */
val FabContentClearance = 88.dp

private val FAB_SIZE = 56.dp

/** Genişleyen FAB'ın tek bir seçeneği. */
data class KlinaraFabAction(
    val label: String,
    val icon: ImageVector,
    val onClick: () -> Unit,
)

/**
 * Birden çok "oluştur" aksiyonu olan ekranlar için genişleyen FAB (ör. Personel: davet et /
 * yeni personel). Tek aksiyon varsa ara adım olmadan düz [KlinaraFab] çizer — tek seçenekli
 * bir menü gereksiz bir dokunuştur.
 *
 * [KlinaraFabBox]'ın `fab` yuvasına değil, ekranın en dış kutusuna tam boy konur: açıkken
 * tüm ekranı karartan perde dokununca menüyü kapatır.
 */
@Composable
fun KlinaraFabMenu(
    actions: List<KlinaraFabAction>,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    if (actions.isEmpty()) return
    if (actions.size == 1) {
        val only = actions.first()
        Box(modifier = modifier.fillMaxSize()) {
            KlinaraFab(
                contentDescription = only.label,
                onClick = only.onClick,
                modifier = Modifier.align(Alignment.BottomEnd).padding(KlinaraMetrics.md),
            )
        }
        return
    }

    var expanded by rememberSaveable { mutableStateOf(false) }
    val colors = KlinaraTheme.colors
    val rotation by animateFloatAsState(if (expanded) 45f else 0f, label = "fab-rotation")

    Box(modifier = modifier.fillMaxSize()) {
        AnimatedVisibility(visible = expanded, enter = fadeIn(), exit = fadeOut()) {
            val interaction = remember { MutableInteractionSource() }
            Box(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .background(colors.charcoal.copy(alpha = SCRIM_ALPHA))
                        .clickable(interactionSource = interaction, indication = null) { expanded = false }
                        .semantics { this.contentDescription = "Menüyü kapat" },
            )
        }

        Column(
            modifier = Modifier.align(Alignment.BottomEnd).padding(KlinaraMetrics.md),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
        ) {
            AnimatedVisibility(
                visible = expanded,
                enter = fadeIn() + slideInVertically { it / 3 },
                exit = fadeOut() + slideOutVertically { it / 3 },
            ) {
                Column(
                    horizontalAlignment = Alignment.End,
                    verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
                ) {
                    actions.forEach { action ->
                        Row(
                            modifier = Modifier.padding(end = (FAB_SIZE - MINI_FAB_SIZE) / 2),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
                        ) {
                            Text(
                                action.label,
                                style = KlinaraType.bodyEmphasis,
                                color = colors.charcoal,
                                modifier =
                                    Modifier
                                        .background(colors.surfaceRaised, RoundedCornerShape(KlinaraMetrics.sm))
                                        .padding(horizontal = KlinaraMetrics.sm + KlinaraMetrics.xs, vertical = 6.dp),
                            )
                            SmallFloatingActionButton(
                                onClick = {
                                    expanded = false
                                    action.onClick()
                                },
                                shape = CircleShape,
                                containerColor = colors.surfaceRaised,
                                contentColor = colors.sageDeep,
                                modifier = Modifier.size(MINI_FAB_SIZE),
                            ) {
                                Icon(action.icon, contentDescription = action.label)
                            }
                        }
                    }
                }
            }

            KlinaraFab(
                contentDescription = if (expanded) "Menüyü kapat" else contentDescription,
                onClick = { expanded = !expanded },
                modifier = Modifier.rotate(rotation),
            )
        }
    }
}

private val MINI_FAB_SIZE = 44.dp
private const val SCRIM_ALPHA = 0.28f
