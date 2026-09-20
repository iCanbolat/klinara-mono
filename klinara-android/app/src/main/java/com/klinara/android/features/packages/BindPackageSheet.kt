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
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSelectableRow
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.PackageEntitlement

/**
 * "Pakete bağla" — randevu detayındaki hizmet satırından açılan hedef.
 *
 * Randevu **henüz tamamlanmadıysa** yalnız bağlar; seans, durum `completed` olduğunda
 * aynı transaction'da düşer. Tamamlanmışsa bağlar VE düşer. Sunucu ikisini tek uçta
 * yapıyor; bu ekran farkı kullanıcıya yazıyor.
 */
@Composable
fun BindPackageSheet(
    state: BindPackageUiState,
    serviceName: String?,
    clock: BranchClock,
    onSelect: (String) -> Unit,
    onBind: () -> Unit,
    onRetry: () -> Unit,
    onDismissError: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box {
        KlinaraScreen(title = "Pakete bağla", modifier = modifier, onBack = onBack) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = onDismissError) }

            when (val options = state.entitlements) {
                Loadable.Loading ->
                    KlinaraSkeleton(style = KlinaraSkeletonStyle.rowsShort)
                is Loadable.Failed ->
                    ErrorBanner(message = options.message, onRetry = if (options.isRetryable) onRetry else null)
                is Loadable.Loaded ->
                    if (options.value.isEmpty()) {
                        EmptyStateView(
                            title = "Kullanılabilir hak yok",
                            message =
                                "Müşterinin ${serviceName ?: "bu hizmet"} için aktif ve süresi dolmamış " +
                                    "paket hakkı bulunmuyor.",
                            icon = Icons.Filled.ShoppingCart,
                        )
                    } else {
                        KlinaraCard(
                            title = serviceName?.let { "$it için haklar" } ?: "Paket hakları",
                            footnote =
                                if (state.consumesNow) {
                                    "Randevu tamamlandığı için seans HEMEN düşer."
                                } else {
                                    "Seans, randevu tamamlandığında düşer."
                                },
                        ) {
                            options.value.forEachIndexed { index, entitlement ->
                                if (index > 0) KlinaraDivider()
                                KlinaraSelectableRow(
                                    title = entitlement.packageName,
                                    detail = detail(entitlement, clock),
                                    isSelected = entitlement.customerPackageItemId == state.selectedItemId,
                                    onClick = { onSelect(entitlement.customerPackageItemId) },
                                )
                            }
                        }
                        KlinaraButton(
                            title = if (state.consumesNow) "Bağla ve düş" else "Pakete bağla",
                            onClick = onBind,
                            isLoading = state.isSaving,
                            enabled = state.canBind,
                        )
                    }
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Bağlanıyor…")
    }
}

private fun detail(
    entitlement: PackageEntitlement,
    clock: BranchClock,
): String =
    listOfNotNull(
        "${entitlement.remainingSessions} seans kaldı",
        entitlement.expiresAt?.let { "${clock.formatDate(it)} tarihinde doluyor" },
    ).joinToString(" · ")
