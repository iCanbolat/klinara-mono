package com.klinara.android.features.packages

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraSelectableRow
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.services.crm.Customer

/**
 * Kalan hakkın başka bir müşteriye devri — **`package:transfer`** (`package:write`'a binmez).
 *
 * Devir bir **taşımadır**, kopyalama değil: kaynaktan `transfer_out`, hedefte açılan YENİ
 * paketten `transfer_in` kaydı çıkar ve iki tarafın toplamı korunur. Hedef paket aynı
 * geçerlilik SONUNU taşır — devir süreyi uzatmaz. Devredilemez satılmış paket için bu
 * ekran hiç açılmaz.
 */
@Composable
fun PackageTransferSheet(
    state: PackageOperationUiState,
    onQueryChange: (String) -> Unit,
    onSelectTarget: (Customer) -> Unit,
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
        title = "Paketi devret",
        submitTitle = "Devret",
        state = state,
        canSubmit = state.canSubmit(PackageOperation.Transfer),
        reasonLabel = "Devir nedeni",
        onReasonChange = onReasonChange,
        onSubmit = onSubmit,
        onRetry = onRetry,
        onDismissError = onDismissError,
        onBack = onBack,
        modifier = modifier,
    ) { pkg ->
        KlinaraCard(title = "Hedef müşteri", footnote = "Paket aynı müşteriye devredilemez.") {
            KlinaraTextField(
                label = "Müşteri ara",
                value = state.customerQuery,
                onValueChange = onQueryChange,
                placeholder = "Ad ya da telefon (en az 2 karakter)",
                error = state.fieldErrors["targetCustomerId"],
            )
            // Seçili müşteri arama daralınca listeden DÜŞMEMELİ — adı kaybolurdu.
            val rows = (listOfNotNull(state.target) + state.candidates).distinctBy { it.id }
            rows.forEachIndexed { index, customer ->
                if (index > 0) KlinaraDivider()
                KlinaraSelectableRow(
                    title = customer.fullName,
                    detail = customer.phone,
                    isSelected = customer.id == state.target?.id,
                    onClick = { onSelectTarget(customer) },
                )
            }
        }
        SessionScopeCards(
            state = state,
            pkg = pkg,
            wholeLabel = "Tüm kalan hakkı devret",
            onWholeChange = onWholeChange,
            onAmountChange = onAmountChange,
        )
    }
}
