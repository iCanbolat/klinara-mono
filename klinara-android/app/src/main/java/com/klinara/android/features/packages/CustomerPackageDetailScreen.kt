package com.klinara.android.features.packages

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.LinearProgressIndicator
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
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.CustomerPackage
import com.klinara.android.services.packages.CustomerPackageItem
import java.time.Instant

/**
 * Müşteri paketi detayı: özet, kalemler, işlemler (A5.3) ve defter.
 *
 * Kalan hak "Defterden türetilir" notuyla gösterilir: ekrandaki sayı sunucunun defter
 * yansımasıdır ve istemci onu hiçbir akışta kendi hesaplamaz.
 */
@Composable
fun CustomerPackageDetailScreen(
    state: CustomerPackageDetailUiState,
    clock: BranchClock,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onLoadMoreLedger: () -> Unit,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
    actions: @Composable (CustomerPackage) -> Unit = {},
) {
    KlinaraScreen(title = state.pkg.valueOrNull?.name ?: "Paket", modifier = modifier, onBack = onBack) {
        when (val pkg = state.pkg) {
            Loadable.Loading ->
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            is Loadable.Failed -> ErrorBanner(message = pkg.message, onRetry = if (pkg.isRetryable) onRetry else null)
            is Loadable.Loaded -> {
                SummaryCard(pkg.value, clock, now)
                ItemsCard(pkg.value)
                actions(pkg.value)
                PackageLedgerSection(
                    ledger = state.ledger,
                    clock = clock,
                    canLoadMore = state.canLoadMoreLedger,
                    isLoadingMore = state.isLoadingMoreLedger,
                    onRetry = onRetry,
                    onLoadMore = onLoadMoreLedger,
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SummaryCard(
    pkg: CustomerPackage,
    clock: BranchClock,
    now: Instant,
) {
    KlinaraCard(title = "Özet", footnote = refundFootnote(pkg)) {
        KlinaraRow(
            label = "Kalan hak",
            value = "${pkg.remainingSessions}/${pkg.totalSessions} seans",
            detail = "Defterden türetilir",
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
            KlinaraBadge(pkg.status.turkishName, tone = toneOf(pkg.status))
            statusBadges(pkg, clock, now)
                .filterNot { it.first == pkg.status.turkishName }
                .forEach { (text, tone) -> KlinaraBadge(text, tone = tone) }
        }
        KlinaraDivider()
        KlinaraRow(label = "Satış tarihi", value = clock.formatDate(pkg.soldAt))
        KlinaraRow(
            label = "Geçerlilik",
            value = pkg.expiresAt?.let(clock::formatDate) ?: "Süresiz",
            detail = if (pkg.isExpired(now)) "Süresi doldu" else null,
        )
        KlinaraRow(label = "Satış tutarı", value = Money.format(pkg.totalPriceMinor, pkg.currency))
        KlinaraRow(
            label = "Kalan hakkın karşılığı",
            value = Money.format(pkg.outstandingMinor, pkg.currency),
            detail = "Satış anındaki tahsisten hesaplanır",
        )
        pkg.note?.takeIf { it.isNotBlank() }?.let { KlinaraRow(label = "Not", detail = it) }
        if (pkg.transferredFromPackageId != null) KlinaraRow(label = "Kaynak", detail = "Bu paket bir devirle oluştu")
    }
}

/**
 * İade edilmişse tutar ve **borcun kapanmadığı** görünmeli: kasa hareketi Faz A6'da
 * bağlanacak, o zamana kadar `pending` bir yükümlülük.
 */
private fun refundFootnote(pkg: CustomerPackage): String? {
    if (pkg.refundedSessions <= 0) return null
    val base = "${pkg.refundedSessions} seans iade edildi · ${Money.format(pkg.refundAmountMinor, pkg.currency)}"
    return if (pkg.hasPendingRefundSettlement) "$base · Kasa hareketi henüz oluşturulmadı (Faz A6)." else base
}

@Composable
private fun ItemsCard(pkg: CustomerPackage) {
    KlinaraCard(
        title = "Kalemler",
        footnote = "Kalan hak KALEM bazındadır: bir kalemin hakkı başka bir hizmet için kullanılamaz.",
    ) {
        pkg.sortedItems.forEachIndexed { index, item ->
            if (index > 0) KlinaraDivider()
            ItemRow(item, pkg.currency)
        }
    }
}

@Composable
private fun ItemRow(
    item: CustomerPackageItem,
    currency: String,
) {
    val colors = KlinaraTheme.colors
    val outstanding = Money.format(item.outstandingMinor, currency)
    val detail = "Kullanılan ${item.usedSessions} seans · Kalan karşılık $outstanding"
    val ratio = "${item.remainingSessions}/${item.quantityTotal}"
    Column(
        modifier =
            Modifier.fillMaxWidth().clearAndSetSemantics {
                contentDescription = "${item.serviceName}, $ratio seans kaldı. $detail"
            },
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                item.serviceName,
                style = KlinaraType.bodyEmphasis,
                color = colors.charcoal,
                modifier = Modifier.weight(1f),
            )
            Text(ratio, style = KlinaraType.bodyEmphasis, color = colors.charcoal)
        }
        LinearProgressIndicator(
            progress = { item.usedFraction },
            modifier = Modifier.fillMaxWidth(),
            color = colors.sage,
            trackColor = colors.sageSoft,
        )
        Text(detail, style = KlinaraType.bodyM, color = colors.charcoalMuted)
    }
}
