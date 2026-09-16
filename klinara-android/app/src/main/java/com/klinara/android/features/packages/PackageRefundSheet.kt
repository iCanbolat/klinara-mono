package com.klinara.android.features.packages

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraStepperRow
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.services.formatting.Money

/**
 * Paket iadesi, tam ya da kısmi — **`package:refund`** (`package:write` üzerine binmez).
 *
 * Tutar **satış anındaki tahsisten** hesaplanır, güncel katalog fiyatından değil:
 * kampanyalı satılan bir paketin iadesi liste fiyatından yapılırsa klinik taşımadığı bir
 * borcu öder. İade SEANS iadesidir; paranın müşteriye ödenmesi uygulamada takip edilmez.
 */
@Composable
fun PackageRefundSheet(
    state: PackageOperationUiState,
    onWholeChange: (Boolean) -> Unit,
    onAmountChange: (itemId: String, value: Int) -> Unit,
    onReasonChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onRetry: () -> Unit,
    onDismissError: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    PackageOperationScaffold(
        title = "Paketi iade et",
        submitTitle = "İade et",
        state = state,
        canSubmit = state.canSubmit(PackageOperation.Refund),
        reasonLabel = "İade nedeni",
        onReasonChange = onReasonChange,
        onSubmit = onSubmit,
        onRetry = onRetry,
        onDismissError = onDismissError,
        onBack = onBack,
        modifier = modifier,
    ) { pkg ->
        SessionScopeCards(
            state = state,
            pkg = pkg,
            wholeLabel = "Tüm kalan hakkı iade et",
            onWholeChange = onWholeChange,
            onAmountChange = onAmountChange,
        )
        KlinaraCard(
            title = "Tutar",
            footnote = "Kalan seanslar düşülür; tutar bilgi amaçlı kaydedilir.",
        ) {
            KlinaraRow(
                label = "Tahmini iade",
                value = Money.format(state.estimatedRefundMinor, pkg.currency),
                detail = "Satış anındaki tahsisten hesaplanır",
            )
        }
    }
}

/**
 * İade ve devrin ortak "kapsam" bölümü: tümü mü, kalem kalem mi.
 *
 * Kalem adımlayıcısının üst sınırı KALAN hak; fazlası hiç seçilemiyor.
 */
@Composable
internal fun SessionScopeCards(
    state: PackageOperationUiState,
    pkg: com.klinara.android.services.packages.CustomerPackage,
    wholeLabel: String,
    onWholeChange: (Boolean) -> Unit,
    onAmountChange: (itemId: String, value: Int) -> Unit,
) {
    KlinaraCard(title = "Kapsam") {
        KlinaraToggleRow(
            label = wholeLabel,
            detail = "${pkg.remainingSessions} seans",
            isOn = state.isWhole,
            onToggle = onWholeChange,
        )
    }
    if (!state.isWhole) {
        KlinaraCard(title = "Kalemler") {
            pkg.sortedItems.filter { it.remainingSessions > 0 }.forEachIndexed { index, item ->
                if (index > 0) KlinaraDivider()
                KlinaraStepperRow(
                    label = item.serviceName,
                    value = state.amounts[item.id] ?: 0,
                    onValueChange = { onAmountChange(item.id, it) },
                    range = 0..item.remainingSessions,
                    detail = "Kalan ${item.remainingSessions} seans",
                    format = { "$it seans" },
                )
            }
        }
    }
}
