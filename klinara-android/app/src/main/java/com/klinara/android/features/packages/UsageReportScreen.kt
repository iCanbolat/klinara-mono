package com.klinara.android.features.packages

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
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
import com.klinara.android.designsystem.components.ReportPeriodBar
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.UsageGrouping

/**
 * Dönem kullanımı — satılan, tüketilen, iade, süre dolumu, devir, düzeltme. `package:read`.
 *
 * Rakamlar **defterden** hesaplanır ve ters kayıtlar tüketimden otomatik DÜŞER: geri
 * alınmış bir tamamlama burada tüketim olarak görünmez. Ekran bunu satırın altına yazıyor.
 */
@Composable
fun UsageReportScreen(
    state: PackageReportsUiState,
    periodLabel: String,
    onShift: (Long) -> Unit,
    onGroupingChange: (UsageGrouping) -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    KlinaraScreen(title = "Dönem kullanımı", modifier = modifier, onBack = onBack) {
        ReportPeriodBar(label = periodLabel, onShift = onShift)
        KlinaraSegmentedPicker(
            options = UsageGrouping.entries,
            selected = state.usageGrouping,
            onSelect = onGroupingChange,
            title = { it.turkishName },
            modifier = Modifier.fillMaxWidth(),
        )
        when (val report = state.usage) {
            Loadable.Loading ->
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            is Loadable.Failed ->
                ErrorBanner(message = report.message, onRetry = if (report.isRetryable) onRetry else null)
            is Loadable.Loaded ->
                if (report.value.data.isEmpty()) {
                    EmptyStateView(
                        title = "Bu dönemde hareket yok",
                        message = "Seçilen aralıkta defter satırı oluşmamış.",
                        icon = Icons.Filled.DateRange,
                    )
                } else {
                    report.value.data.forEach { row ->
                        KlinaraCard(title = row.groupLabel) {
                            KlinaraRow(label = "Satılan", value = "${row.purchased} seans")
                            KlinaraDivider()
                            KlinaraRow(
                                label = "Tüketilen",
                                value = "${row.consumed} seans",
                                detail = "Ters kayıtlar düşülmüştür",
                            )
                            KlinaraDivider()
                            KlinaraRow(label = "İade", value = "${row.refunded} seans")
                            KlinaraRow(label = "Süre dolumu", value = "${row.expired} seans")
                            KlinaraRow(label = "Devir", value = "${row.transferred} seans")
                            KlinaraRow(label = "Manuel düzeltme", value = "${row.adjusted} seans")
                        }
                    }
                }
        }
    }
}
