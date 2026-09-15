package com.klinara.android.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType

/** Tek sayılık özet kartının verisi. `value == null` → "—" (izin var, sayı yok). */
@Immutable
data class KlinaraStat(
    val label: String,
    val value: String?,
    val icon: ImageVector? = null,
    val hint: String? = null,
)

/**
 * Tek sayılık özet kartı — web `StatCard` karşılığı: üstte etiket + ikon, ortada büyük değer,
 * altta ipucu (geçen aya göre değişim gibi).
 *
 * **Yükseklik içerikten BAĞIMSIZ.** Şeritteki kartlar yan yana ve alt alta hizalı durmalı; ipucu
 * olan kartla olmayan, ipucu bir satıra sığanla sığmayan farklı boyda çıkıyordu. Satır bütçesi
 * sabit: etiket 1, değer 1, ipucu HER ZAMAN 2 satır yer tutar (boşsa da). Sabit dp yükseklik
 * yerine satır bütçesi: büyük yazı boyunda (fontScale 2.0) kart kırpılmadan birlikte büyür.
 *
 * TalkBack kartı TEK öğe olarak okur ("Bu ay ciro, 12.500,00 ₺, Geçen aya göre +%8"): üç ayrı
 * odak durağı bir sayıyı üç parçaya bölerdi.
 */
@Composable
fun KlinaraStatCard(
    stat: KlinaraStat,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
) {
    val colors = KlinaraTheme.colors
    val shape = RoundedCornerShape(KlinaraMetrics.cardRadius)
    val value = stat.value ?: "—"

    Column(
        modifier =
            modifier
                .clip(shape)
                .background(colors.surfaceRaised)
                .border(KlinaraMetrics.borderWidth, colors.border, shape)
                .padding(KlinaraMetrics.md)
                .clearAndSetSemantics {
                    contentDescription = listOfNotNull(stat.label, if (isLoading) "Yükleniyor" else value, stat.hint)
                        .joinToString(", ")
                },
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                KlinaraType.labelText(stat.label),
                style = KlinaraType.label,
                color = colors.charcoalMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            stat.icon?.let {
                Icon(it, contentDescription = null, tint = colors.sageDeep, modifier = Modifier.size(ICON_SIZE))
            }
        }
        // Yer tutucu değerin KENDİ satır yüksekliğini kullanır: yükleme bitince kart boyu değişmez.
        Box(if (isLoading) Modifier.width(PLACEHOLDER_WIDTH) else Modifier) {
            Text(
                value,
                style = KlinaraType.titleM,
                color = if (isLoading) Color.Transparent else colors.charcoal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (isLoading) {
                Box(
                    Modifier
                        .matchParentSize()
                        .clip(RoundedCornerShape(KlinaraMetrics.xs))
                        .background(colors.border.copy(alpha = 0.5f)),
                )
            }
        }
        Text(
            stat.hint.orEmpty(),
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
            minLines = HINT_LINES,
            maxLines = HINT_LINES,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Özet kartı şeridi — iki sütunlu ızgara. Telefon genişliğinde dört kart yan yana sığmaz; web de
 * dar ekranda iki sütuna iner. Tek kalan kart satırın yarısında durur, genişlemez: kart boyları
 * birbirinden zıplamasın.
 */
@Composable
fun KlinaraStatStrip(
    stats: List<KlinaraStat>,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
        stats.chunked(COLUMNS).forEach { row ->
            Row(
                // Satır bütçesi zaten eşit boy veriyor; IntrinsicSize yalnız bir etiketin cihaz
                // fontunda beklenmedik şekilde yükseldiği durumda komşuyu da hizalı tutar.
                modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            ) {
                row.forEach { stat ->
                    KlinaraStatCard(
                        stat = stat,
                        isLoading = isLoading,
                        modifier = Modifier.weight(1f).fillMaxHeight(),
                    )
                }
                repeat(COLUMNS - row.size) { Column(Modifier.weight(1f)) {} }
            }
        }
    }
}

private const val COLUMNS = 2
private val ICON_SIZE = 16.dp
private val PLACEHOLDER_WIDTH = 96.dp
private const val HINT_LINES = 2

@KlinaraPreviews
@Composable
private fun KlinaraStatStripPreview() {
    KlinaraTheme {
        KlinaraStatStrip(
            stats =
                listOf(
                    KlinaraStat("Bugünkü randevu", "12", Icons.Filled.DateRange, "8 aktif · 4 tamamlandı"),
                    KlinaraStat("Bu ay ciro", "182.500,00 ₺", Icons.Filled.ShoppingCart, "Geçen aya göre +%8"),
                    KlinaraStat("Bu ay doluluk", null),
                ),
        )
    }
}
