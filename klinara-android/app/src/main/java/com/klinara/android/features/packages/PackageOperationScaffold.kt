package com.klinara.android.features.packages

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraTextEditor
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.CustomerPackage
import com.klinara.android.services.packages.OperationReason

/**
 * Üç işlem ekranının ortak iskeleti: yükleme/hata dalları, afiş, gerekçe alanı ve tek bir
 * birincil düğme. iOS `KlinaraFormScaffold`'un karşılığı — ama tasarım sistemine değil
 * buraya: bugün tek çağıranı paket işlemleri.
 */
@Composable
internal fun PackageOperationScaffold(
    title: String,
    submitTitle: String,
    state: PackageOperationUiState,
    canSubmit: Boolean,
    reasonLabel: String,
    onReasonChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onRetry: () -> Unit,
    onDismissError: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.(CustomerPackage) -> Unit,
) {
    Box {
        KlinaraScreen(title = title, modifier = modifier, onBack = onBack) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = onDismissError) }
            when (val pkg = state.pkg) {
                Loadable.Loading ->
                    Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
                is Loadable.Failed ->
                    ErrorBanner(message = pkg.message, onRetry = if (pkg.isRetryable) onRetry else null)
                is Loadable.Loaded -> {
                    content(pkg.value)
                    KlinaraCard(title = "Gerekçe") {
                        KlinaraTextEditor(
                            label = reasonLabel,
                            value = state.reason,
                            onValueChange = onReasonChange,
                            placeholder = "En az ${OperationReason.MIN_LENGTH} karakter",
                            error = state.fieldErrors["reason"],
                        )
                    }
                    KlinaraButton(
                        title = submitTitle,
                        onClick = onSubmit,
                        enabled = canSubmit,
                        isLoading = state.isSaving,
                    )
                }
            }
        }
        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}
