package com.klinara.android.features.packages

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraStepperRow

/**
 * Kalan hakkı manuel düzeltme — `package:write`.
 *
 * **Gerekçe zorunlu** ve bu sunucuda, hatta veritabanında zorlanıyor: düzeltme deftere
 * `manual_adjustment` olarak iz bırakır; iz gerekçesiz olursa "neden 6 değil 5?" sorusu
 * yine cevapsız kalırdı.
 *
 * Adımlayıcının alt sınırı `−kalan`: kalan hakkı eksiye düşürecek adım HİÇ sunulmuyor —
 * basılabilen ama daima 409 dönen bir düğme olmazdı.
 */
@Composable
fun PackageAdjustSheet(
    state: PackageOperationUiState,
    onAmountChange: (itemId: String, value: Int) -> Unit,
    onReasonChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onRetry: () -> Unit,
    onDismissError: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    PackageOperationScaffold(
        title = "Kalan hakkı düzelt",
        submitTitle = "Uygula",
        state = state,
        canSubmit = state.canSubmit(PackageOperation.Adjust),
        reasonLabel = "Neden düzeltiliyor?",
        onReasonChange = onReasonChange,
        onSubmit = onSubmit,
        onRetry = onRetry,
        onDismissError = onDismissError,
        onBack = onBack,
        modifier = modifier,
    ) { pkg ->
        KlinaraCard(
            title = "Kalemler",
            footnote = "Pozitif değer hak ekler, negatif düşer. Kalan hak eksiye inemez.",
        ) {
            pkg.sortedItems.forEachIndexed { index, item ->
                if (index > 0) KlinaraDivider()
                val delta = state.amounts[item.id] ?: 0
                KlinaraStepperRow(
                    label = item.serviceName,
                    value = delta,
                    onValueChange = { onAmountChange(item.id, it) },
                    range = -item.remainingSessions..item.quantityTotal,
                    detail =
                        if (delta == 0) {
                            "Kalan ${item.remainingSessions}"
                        } else {
                            "Kalan ${item.remainingSessions} → ${item.remainingSessions + delta}"
                        },
                    format = { if (it > 0) "+$it" else "$it" },
                )
            }
        }
    }
}
