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
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
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
                KlinaraSkeleton(style = KlinaraSkeletonStyle.detail)
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

/** İade edilmişse seans sayısı ve bilgi amaçlı tutar görünür. */
private fun refundFootnote(pkg: CustomerPackage): String? {
    if (pkg.refundedSessions <= 0) return null
    return "${pkg.refundedSessions} seans iade edildi · ${Money.format(pkg.refundAmountMinor, pkg.currency)}"
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

/**
 * İşlem kartı — üç düğme ÜÇ AYRI izinle (A5.3). `package:refund` ve `package:transfer`,
 * `package:write`'a binmez: resepsiyonun düzeltme yetkisi iade yetkisi demek değil.
 *
 * Yapılamayacak işlem **pasif düğme olarak değil, hiç çizilmez** ve sebebi dipnotta
 * yazılır. Yetkisi olmayana ise ne düğme ne dipnot: yapamayacağı bir şeyi anlatmak da
 * bir vaattir. Hiçbir işlem yapılamıyorsa kart hiç kurulmaz.
 */
@Composable
fun PackageActionsCard(
    pkg: CustomerPackage,
    permissions: PackagePermissions,
    now: Instant,
    onOperation: (PackageOperation) -> Unit,
) {
    val available = availableOperations(pkg, permissions, now)
    val note = actionsFootnote(pkg, permissions, now)
    if (available.isEmpty() && note == null) return

    KlinaraCard(title = "İşlemler", footnote = note) {
        available.forEach { operation ->
            KlinaraButton(
                title =
                    when (operation) {
                        PackageOperation.Adjust -> "Kalan hakkı düzelt"
                        PackageOperation.Refund -> "İade et"
                        PackageOperation.Transfer -> "Devret"
                    },
                onClick = { onOperation(operation) },
                kind = KlinaraButtonKind.Secondary,
            )
        }
    }
}

/** Oturumdan çözülmüş paket izinleri — ekran bunları `session.can(...)`'dan kurar. */
data class PackagePermissions(
    val canWrite: Boolean,
    val canRefund: Boolean,
    val canTransfer: Boolean,
) {
    val any: Boolean get() = canWrite || canRefund || canTransfer
}

/**
 * Hangi işlemler GERÇEKTEN yapılabilir — saf fonksiyon, altı rolün matrisi testte sürülüyor.
 *
 * Düzeltme kalan hak sıfır olsa da yapılabilir (hak EKLEMEK de bir düzeltme); iade ve devir
 * kalan hak ister; devir ayrıca devredilebilir satılmış olmayı.
 */
fun availableOperations(
    pkg: CustomerPackage,
    permissions: PackagePermissions,
    now: Instant,
): List<PackageOperation> {
    if (!pkg.status.isOpen) return emptyList()
    val hasBalance = pkg.isConsumable(now)
    return buildList {
        if (permissions.canWrite) add(PackageOperation.Adjust)
        if (permissions.canRefund && hasBalance) add(PackageOperation.Refund)
        if (permissions.canTransfer && hasBalance && pkg.isTransferable) add(PackageOperation.Transfer)
    }
}

private fun actionsFootnote(
    pkg: CustomerPackage,
    permissions: PackagePermissions,
    now: Instant,
): String? =
    when {
        !permissions.any -> null
        !pkg.status.isOpen -> "Kapanmış pakette işlem yapılamaz."
        (permissions.canRefund || permissions.canTransfer) && !pkg.isConsumable(now) ->
            if (pkg.isExpired(now)) "Süresi dolmuş pakette iade ve devir yapılamaz." else "Kalan hak yok."
        permissions.canTransfer && !pkg.isTransferable -> "Bu paket devredilemez olarak satıldı."
        else -> null
    }
