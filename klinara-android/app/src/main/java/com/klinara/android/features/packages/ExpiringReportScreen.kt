package com.klinara.android.features.packages

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.ReportPeriodBar
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.ExpiringRow

/**
 * Yaklaşan süre dolumu — seçilen dönemde yanacak paketler. `package:read`.
 *
 * Tutar alanı YALNIZ `report.revenue:read` ile dolu gelir; izin yoksa sunucu `null` döner
 * ve ekran **"—"** yazar. "0 ₺" yazmak taşınmayan bir borç iddiası olurdu ve "göremiyorsun"
 * ile "sıfır" arasındaki fark kaybolurdu.
 *
 * Satır müşteri kartını açar (iOS gibi) — A5.4'te yoktu; A7.3'te kabuk sekmeler arası
 * gezinmeyi kazandı: rapor Yönetim'de, kart Müşteriler sekmesinde açılır. `customer:read`
 * yoksa ([onOpenCustomer] `null`) satır tıklanmaz.
 *
 * Liste imleçlidir ve **sonraki sayfa okunur**: iOS'ta bir kez `pageInfo` okunmadan rapor
 * ilk 50 satırda sessizce kesilmiş, kullanıcı listenin bittiğini sanmıştı.
 */
@Composable
fun ExpiringReportScreen(
    state: PackageReportsUiState,
    periodLabel: String,
    clock: BranchClock,
    onShift: (Long) -> Unit,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenCustomer: ((String) -> Unit)? = null,
) {
    KlinaraScreen(title = "Süre dolumu", modifier = modifier, onBack = onBack) {
        ReportPeriodBar(label = periodLabel, onShift = onShift)
        when (val report = state.expiring) {
            Loadable.Loading ->
                KlinaraSkeleton(style = KlinaraSkeletonStyle.rows)
            is Loadable.Failed ->
                ErrorBanner(message = report.message, onRetry = if (report.isRetryable) onRetry else null)
            is Loadable.Loaded ->
                if (report.value.data.isEmpty()) {
                    EmptyStateView(
                        title = "Bu dönemde süre dolumu yok",
                        message = "Seçilen aralıkta süresi dolacak paket bulunmuyor.",
                        icon = Icons.Filled.DateRange,
                    )
                } else {
                    KlinaraCard(title = "Paketler", footnote = "Dönem sonu tarihi aralığa dâhil değildir.") {
                        report.value.data.forEachIndexed { index, row ->
                            if (index > 0) KlinaraDivider()
                            if (onOpenCustomer != null) {
                                KlinaraNavigationRow(
                                    label = row.customerName,
                                    value = amountLabel(row),
                                    detail = rowDetail(row, clock),
                                    onClick = { onOpenCustomer(row.customerId) },
                                )
                            } else {
                                KlinaraRow(
                                    label = row.customerName,
                                    value = amountLabel(row),
                                    detail = rowDetail(row, clock),
                                )
                            }
                        }
                        if (state.canLoadMoreExpiring || state.isLoadingMoreExpiring) {
                            KlinaraButton(
                                title = "Sonraki sayfa",
                                onClick = onLoadMore,
                                kind = KlinaraButtonKind.Tertiary,
                                isLoading = state.isLoadingMoreExpiring,
                            )
                        }
                    }
                }
        }
    }
}

private fun rowDetail(
    row: ExpiringRow,
    clock: BranchClock,
): String = "${row.packageName} · ${row.remainingSessions} seans · ${clock.formatDate(row.expiresAt)}"

/** İzin yoksa sunucu `null` döner → "—". Sıfır DEĞİL. */
internal fun amountLabel(row: ExpiringRow): String = row.outstandingMinor?.let { Money.format(it) } ?: "—"
