package com.klinara.android.features.packages

import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSearchablePicker
import com.klinara.android.designsystem.components.KlinaraTextEditor
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.PackageDefinition

/**
 * Paket satış sayfası — sheet DEĞİL, gerçek bir hedef (§5.3 Kural 2).
 *
 * Satışta ne olacağı **satmadan önce** görünür: kalemler, süre ve devredilebilirlik satış
 * anında DONDURULUR ve sonradan düzeltilemez.
 */
@Composable
fun SellPackageSheet(
    state: SellPackageUiState,
    branchName: String?,
    canSwitchBranch: Boolean,
    onSelect: (String) -> Unit,
    onNoteChange: (String) -> Unit,
    onSell: () -> Unit,
    onRetry: () -> Unit,
    onDismissError: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box {
        KlinaraScreen(title = "Paket sat", modifier = modifier, onBack = onBack) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = onDismissError) }

            when (val options = state.options) {
                Loadable.Loading ->
                    Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
                is Loadable.Failed ->
                    ErrorBanner(message = options.message, onRetry = if (options.isRetryable) onRetry else null)
                is Loadable.Loaded ->
                    if (options.value.isEmpty()) {
                        EmptyStateView(
                            title = "Satılabilir paket yok",
                            // Şubenin ADI yazılıyor: çok şubeli bir kiracıda "bu şubede"
                            // hangi şube olduğunu söylemiyordu.
                            message = emptyMessage(branchName, canSwitchBranch),
                            icon = Icons.Filled.ShoppingCart,
                        )
                    } else {
                        KlinaraCard(title = "Paket") {
                            KlinaraSearchablePicker(
                                options = options.value,
                                key = { it.id },
                                label = { it.name },
                                detail = { optionDetail(it) },
                                isSelected = { it.id == state.selectedId },
                                onSelect = { onSelect(it.id) },
                                searchLabel = "Paket ara",
                            )
                        }
                        state.selected?.let { SalePreview(it) }
                        KlinaraCard(title = "Not") {
                            KlinaraTextEditor(
                                label = "Satış notu",
                                value = state.note,
                                onValueChange = onNoteChange,
                                placeholder = "İsteğe bağlı",
                                error = state.fieldErrors["note"],
                            )
                        }
                        KlinaraButton(
                            title = "Paketi sat",
                            onClick = onSell,
                            icon = Icons.Filled.ShoppingCart,
                            isLoading = state.isSaving,
                            enabled = state.canSell,
                        )
                    }
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Satış kaydediliyor…")
    }
}

@Composable
private fun SalePreview(definition: PackageDefinition) {
    KlinaraCard(title = "Satış önizlemesi", footnote = previewFootnote(definition)) {
        definition.sortedItems.forEachIndexed { index, item ->
            if (index > 0) KlinaraDivider()
            KlinaraRow(
                label = item.serviceName,
                value = "${item.quantity} seans",
                detail = "${Money.format(item.unitListPriceMinor, definition.currency)} birim",
            )
        }
        KlinaraDivider()
        KlinaraRow(
            label = "Satış tutarı",
            value = Money.format(definition.totalPriceMinor, definition.currency),
            detail =
                definition.discountMinor?.let {
                    "Liste: ${Money.format(definition.listPriceMinor, definition.currency)} · " +
                        "İndirim: ${Money.format(it, definition.currency)}"
                },
        )
    }
}

private fun optionDetail(definition: PackageDefinition): String =
    "${definition.totalSessions} seans · ${Money.format(definition.totalPriceMinor, definition.currency)}"

private fun previewFootnote(definition: PackageDefinition): String =
    listOf(
        definition.validityDays?.let { "Satıştan itibaren $it gün geçerli" } ?: "Süresiz",
        if (definition.isTransferable) "Devredilebilir" else "Devredilemez",
        "Satış anındaki fiyat ve kalemler dondurulur; tanım sonradan değişse bile bu paket etkilenmez.",
    ).joinToString(" · ")

private fun emptyMessage(
    branchName: String?,
    canSwitchBranch: Boolean,
): String {
    if (branchName == null) return "Satışa açık paket tanımı bulunmuyor."
    val switchHint = if (canSwitchBranch) " Başka bir şubede satış için önce şubeyi değiştirin." else ""
    return "$branchName şubesinde satışa açık paket tanımı bulunmuyor.$switchHint"
}
