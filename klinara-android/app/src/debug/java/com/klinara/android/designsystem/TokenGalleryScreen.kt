package com.klinara.android.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Yalnız debug varyantında derlenir; release APK'de kodu bile bulunmaz.
 *
 * A0.2'nin "Bitti" ölçütü buna bakılarak doğrulanır: her token açık ve koyu temada
 * doğru mu, dokuz tipografi stili hedeflenen ağırlıkta mı (Manrope'nin ExtraLight
 * tuzağını yakalayan en hızlı yol), ölçü skalası tutarlı mı.
 */
@Composable
fun TokenGalleryScreen(modifier: Modifier = Modifier) {
    val colors = KlinaraTheme.colors

    LazyColumn(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(horizontal = KlinaraMetrics.screenInset),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = KlinaraMetrics.xl),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
    ) {
        item {
            Text("Token galerisi", style = KlinaraType.displayM, color = colors.charcoal)
            Text(
                KlinaraType.diagnostics,
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
                modifier = Modifier.padding(top = KlinaraMetrics.sm),
            )
        }

        item { SectionHeader("Renkler") }
        items(colorTokens(colors)) { (name, color) -> ColorRow(name, color, colors.border) }

        item { SectionHeader("Türetilmiş opaklıklar") }
        items(derivedTokens(colors)) { (name, color) -> ColorRow(name, color, colors.border) }

        item { SectionHeader("Tipografi") }
        items(typeTokens()) { (name, style) ->
            Column(modifier = Modifier.padding(vertical = KlinaraMetrics.xs)) {
                Text(
                    KlinaraType.labelText(name),
                    style = KlinaraType.label,
                    color = colors.charcoalMuted,
                )
                Text(
                    "Cilt bakımı randevusu — İĞNE ŞÜKRÜ 0532",
                    style = style,
                    color = colors.charcoal,
                )
            }
        }

        item { SectionHeader("Ölçü") }
        items(metricTokens()) { (name, size) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    name,
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                    modifier = Modifier.width(140.dp),
                )
                Box(
                    Modifier
                        .height(KlinaraMetrics.sm)
                        .width(size)
                        .background(colors.sage, RoundedCornerShape(KlinaraMetrics.xs)),
                )
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        KlinaraType.labelText(title),
        style = KlinaraType.label,
        color = KlinaraTheme.colors.charcoalMuted,
        modifier = Modifier.padding(top = KlinaraMetrics.lg),
    )
}

@Composable
private fun ColorRow(
    name: String,
    color: Color,
    borderColor: Color,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(KlinaraMetrics.xxl)
                .background(color, RoundedCornerShape(KlinaraMetrics.controlRadius))
                .border(KlinaraMetrics.borderWidth, borderColor, RoundedCornerShape(KlinaraMetrics.controlRadius)),
        )
        Text(
            name,
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoal,
            modifier = Modifier.padding(start = KlinaraMetrics.md),
        )
    }
}

private fun colorTokens(c: KlinaraColors) =
    listOf(
        "sage" to c.sage,
        "sageDeep" to c.sageDeep,
        "sageSoft" to c.sageSoft,
        "charcoal" to c.charcoal,
        "charcoalMuted" to c.charcoalMuted,
        "surface" to c.surface,
        "surfaceRaised" to c.surfaceRaised,
        "border" to c.border,
        "borderFocus" to c.borderFocus,
        "disabled" to c.disabled,
        "danger" to c.danger,
    )

private fun derivedTokens(c: KlinaraColors) =
    listOf(
        "dangerSurface" to c.dangerSurface,
        "dangerBorder" to c.dangerBorder,
        "badgeNeutralSurface" to c.badgeNeutralSurface,
        "badgeMutedSurface" to c.badgeMutedSurface,
        "warningSurface" to c.warningSurface,
        "trackBorder" to c.trackBorder,
        "overlayScrim" to c.overlayScrim,
    )

private fun typeTokens(): List<Pair<String, TextStyle>> =
    listOf(
        "displayL" to KlinaraType.displayL,
        "displayM" to KlinaraType.displayM,
        "titleM" to KlinaraType.titleM,
        "bodyL" to KlinaraType.bodyL,
        "bodyM" to KlinaraType.bodyM,
        "bodyEmphasis" to KlinaraType.bodyEmphasis,
        "button" to KlinaraType.button,
        "label" to KlinaraType.label,
        "code" to KlinaraType.code,
    )

private fun metricTokens(): List<Pair<String, Dp>> =
    listOf(
        "xs 4" to KlinaraMetrics.xs,
        "sm 8" to KlinaraMetrics.sm,
        "md 16" to KlinaraMetrics.md,
        "lg 24" to KlinaraMetrics.lg,
        "xl 32" to KlinaraMetrics.xl,
        "xxl 40" to KlinaraMetrics.xxl,
        "controlHeight 52" to KlinaraMetrics.controlHeight,
        "minTouchTarget 48" to KlinaraMetrics.minTouchTarget,
    )

@KlinaraPreviews
@Composable
private fun TokenGalleryPreview() {
    KlinaraTheme { TokenGalleryScreen() }
}
