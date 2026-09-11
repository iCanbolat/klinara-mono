package com.klinara.android.features.packages

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.LedgerEntryType
import com.klinara.android.services.packages.PackageLedgerEntry

/**
 * Paket defteri — append-only, yeniden eskiye. **Sayaç değil, defter.**
 *
 * Defter bir işlem geçmişi listesi değil, kalan hakkın KAYNAĞIDIR: bir kalemin
 * satırlarının toplamı o kalemin kalan hakkıdır. Bu yüzden düzeltmeler de silinmez, ters
 * kayıt olarak görünür; "neden 6 değil 5?" sorusu ancak böyle cevaplanır.
 */
@Composable
fun PackageLedgerSection(
    ledger: Loadable<List<PackageLedgerEntry>>,
    clock: BranchClock,
    canLoadMore: Boolean,
    isLoadingMore: Boolean,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (ledger) {
        Loadable.Loading ->
            KlinaraCard(title = "Defter", modifier = modifier) {
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            }
        is Loadable.Failed -> ErrorBanner(message = ledger.message, onRetry = if (ledger.isRetryable) onRetry else null)
        is Loadable.Loaded ->
            KlinaraCard(
                title = "Defter",
                footnote = "Satırlar değiştirilemez ve silinemez. Düzeltmeler ters kayıt olarak eklenir.",
                modifier = modifier,
            ) {
                if (ledger.value.isEmpty()) KlinaraRow(label = "Henüz kayıt yok")
                ledger.value.forEachIndexed { index, entry ->
                    if (index > 0) KlinaraDivider()
                    LedgerRow(entry, clock)
                }
                if (canLoadMore || isLoadingMore) {
                    KlinaraButton(
                        title = "Daha eski kayıtlar",
                        onClick = onLoadMore,
                        kind = KlinaraButtonKind.Tertiary,
                        isLoading = isLoadingMore,
                    )
                }
            }
    }
}

@Composable
private fun LedgerRow(
    entry: PackageLedgerEntry,
    clock: BranchClock,
) {
    val colors = KlinaraTheme.colors
    val description =
        listOfNotNull(
            entry.serviceName,
            entry.entryType.turkishName,
            "${entry.signedDelta} seans",
            if (entry.isReversal) "ters kayıt" else null,
            clock.formatDateTime(entry.createdAt),
            entry.reason,
        ).joinToString(", ")

    // Satır TEK düğüm: TalkBack "Lazer, Kullanım, −1 seans, …" diye bir kez okur.
    Column(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = description },
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(entry.serviceName, style = KlinaraType.bodyEmphasis, color = colors.charcoal)
                Text(clock.formatDateTime(entry.createdAt), style = KlinaraType.bodyM, color = colors.charcoalMuted)
            }
            // İşaret HER ZAMAN yazılır: "1" ile "+1" arasındaki fark hakkın yönü.
            Text(
                entry.signedDelta,
                style = KlinaraType.bodyEmphasis,
                color = if (entry.delta > 0) colors.sageDeep else colors.charcoal,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
            KlinaraBadge(entry.entryType.turkishName, tone = toneOf(entry.entryType))
            if (entry.isReversal) KlinaraBadge("Ters kayıt", tone = KlinaraBadgeTone.Warning)
        }
        entry.reason?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = KlinaraType.bodyM, color = colors.charcoalMuted)
        }
    }
}

internal fun toneOf(type: LedgerEntryType): KlinaraBadgeTone =
    when (type) {
        LedgerEntryType.Purchase, LedgerEntryType.TransferIn -> KlinaraBadgeTone.Positive
        LedgerEntryType.Consume -> KlinaraBadgeTone.Neutral
        LedgerEntryType.Refund, LedgerEntryType.Expire, LedgerEntryType.TransferOut -> KlinaraBadgeTone.Warning
        LedgerEntryType.ManualAdjustment, LedgerEntryType.Unknown -> KlinaraBadgeTone.Muted
    }
