package com.klinara.android.features.packages

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.OutstandingGrouping

/**
 * Taşınan yükümlülük — satılmış ama kullanılmamış seansların parasal karşılığı.
 *
 * Bu rapor kliniğin **borcudur**, geliri değil. Tutar satış anındaki tahsisten
 * hesaplanır; güncel katalog fiyatından hesaplansaydı zam yapan bir klinik taşımadığı
 * bir borcu raporlardı. Dönemsiz: yükümlülük bir ANLIK durum, bir akış değil.
 */
@Composable
fun OutstandingReportScreen(
    state: PackageReportsUiState,
    onGroupingChange: (OutstandingGrouping) -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    KlinaraScreen(title = "Taşınan yükümlülük", modifier = modifier, onBack = onBack) {
        KlinaraSegmentedPicker(
            options = OutstandingGrouping.entries,
            selected = state.outstandingGrouping,
            onSelect = onGroupingChange,
            title = { it.turkishName },
            modifier = Modifier.fillMaxWidth(),
        )
        when (val report = state.outstanding) {
            Loadable.Loading ->
                KlinaraSkeleton(style = KlinaraSkeletonStyle.rows)
            is Loadable.Failed ->
                ErrorBanner(message = report.message, onRetry = if (report.isRetryable) onRetry else null)
            is Loadable.Loaded -> {
                val totals = report.value.totals
                KlinaraCard(footnote = "Satılmış ama kullanılmamış seansların karşılığı.") {
                    Text(
                        Money.format(totals.outstandingMinor, totals.currency),
                        style = KlinaraType.displayM,
                        color = KlinaraTheme.colors.charcoal,
                    )
                    Text(
                        "${totals.packages} paket · ${totals.remainingSessions} seans",
                        style = KlinaraType.bodyM,
                        color = KlinaraTheme.colors.charcoalMuted,
                    )
                }
                if (report.value.data.isEmpty()) {
                    EmptyStateView(
                        title = "Açık paket yok",
                        message = "Kullanılmamış seans hakkı bulunmuyor.",
                        icon = Icons.Filled.ShoppingCart,
                    )
                } else {
                    KlinaraCard(title = state.outstandingGrouping.turkishName) {
                        report.value.data.forEachIndexed { index, row ->
                            if (index > 0) KlinaraDivider()
                            KlinaraRow(
                                label = row.groupLabel,
                                value = Money.format(row.outstandingMinor, totals.currency),
                                detail = "${row.packages} paket · ${row.remainingSessions} seans",
                            )
                        }
                    }
                }
            }
        }
    }
}
