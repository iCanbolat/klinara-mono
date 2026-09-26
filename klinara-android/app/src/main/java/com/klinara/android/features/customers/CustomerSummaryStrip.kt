package com.klinara.android.features.customers

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraPreviews
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.services.crm.CustomerSummary

/**
 * Müşteriler listesinin üstündeki kompakt özet: tek kart, dört sütun.
 *
 * Dashboard'daki 2×2 `KlinaraStatStrip` burada BİLEREK kullanılmıyor — listenin asıl içerik
 * olduğu bir ekranda dört büyük kart ilk ekranı yutardı. `summary == null` iken sayılar yer
 * tutucuyla çizilir; kart boyu yükleme bitince değişmez. iOS `CustomerSummaryStrip` ile aynı.
 */
@Composable
fun CustomerSummaryStrip(
    summary: CustomerSummary?,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    val shape = RoundedCornerShape(KlinaraMetrics.cardRadius)
    val lapsed = summary?.lapsed ?: 0
    val items =
        listOf(
            SummaryItem("Toplam", summary?.total, colors.charcoal),
            SummaryItem("Yeni · 30g", summary?.newLast30Days, colors.sageDeep),
            SummaryItem("Aktif · 90g", summary?.activeLast90Days, colors.charcoal),
            SummaryItem("Geri kazan", summary?.lapsed, if (lapsed > 0) colors.danger else colors.charcoal),
        )

    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .height(IntrinsicSize.Min)
                .clip(shape)
                .background(colors.surfaceRaised)
                .border(KlinaraMetrics.borderWidth, colors.border, shape)
                .padding(vertical = KlinaraMetrics.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        items.forEachIndexed { index, item ->
            if (index > 0) {
                Box(
                    Modifier
                        .width(KlinaraMetrics.borderWidth)
                        .fillMaxHeight()
                        .padding(vertical = KlinaraMetrics.xs)
                        .background(colors.border),
                )
            }
            SummaryCell(item, Modifier.weight(1f))
        }
    }
}

private data class SummaryItem(
    val label: String,
    val value: Int?,
    val accent: Color,
)

@Composable
private fun SummaryCell(
    item: SummaryItem,
    modifier: Modifier = Modifier,
) {
    val colors = KlinaraTheme.colors
    val isLoading = item.value == null
    Column(
        modifier =
            modifier.clearAndSetSemantics {
                contentDescription = "${item.label}: ${item.value ?: "yükleniyor"}"
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(
                item.value?.toString() ?: "00",
                style = KlinaraType.titleM,
                color = if (isLoading) Color.Transparent else item.accent,
                maxLines = 1,
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
            item.label,
            style = KlinaraType.bodyM.copy(fontSize = 11.sp, fontWeight = FontWeight.Medium),
            color = colors.charcoalMuted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = KlinaraMetrics.xs),
        )
    }
}

@KlinaraPreviews
@Composable
private fun CustomerSummaryStripPreview() {
    KlinaraTheme {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            CustomerSummaryStrip(CustomerSummary(total = 248, newLast30Days = 12, activeLast90Days = 131, lapsed = 37))
            CustomerSummaryStrip(null)
        }
    }
}
