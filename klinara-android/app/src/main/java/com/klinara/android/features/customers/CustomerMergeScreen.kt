package com.klinara.android.features.customers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.PhoneNumber
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.crm.Customer
import com.klinara.android.services.networking.Loadable

/**
 * Mükerrer kayıt birleştirme — **`customer:merge`**.
 *
 * Bu ekrana giden yol yalnız izin varken çizilir; ekran yine de kendi kapısını tutmaz
 * çünkü tek çağıranı kart ve orada kapı zaten var. (Derin bağlantı yok.)
 */
@Composable
fun CustomerMergeScreen(
    container: ServiceContainer,
    targetCustomerId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: CustomerMergeViewModel =
        viewModel(
            key = "customer-merge-$targetCustomerId",
            factory = CustomerMergeViewModel.factory(container, targetCustomerId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(targetCustomerId) { viewModel.load() }

    Box {
        KlinaraScreen(title = "Kayıt birleştir", modifier = modifier, onBack = onBack) {
            state.error?.let {
                ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError)
            }

            val target = state.target.valueOrNull

            KlinaraCard(
                title = "Hayatta kalacak kayıt",
                footnote =
                    "Seçtiğiniz mükerrer kayıt arşivlenir; randevuları, notları ve " +
                        "etiketleri bu karta taşınır. İşlem geri alınamaz.",
            ) {
                Text(
                    text = target?.fullName ?: "Yükleniyor…",
                    style = KlinaraType.bodyEmphasis,
                    color = KlinaraTheme.colors.charcoal,
                )
                target?.phone?.let {
                    Text(
                        text = PhoneNumber.pretty(it),
                        style = KlinaraType.bodyM,
                        color = KlinaraTheme.colors.charcoalMuted,
                    )
                }
            }

            state.result?.let { result ->
                MergeResultCard(summary = result.movedSummary)
            }

            if (state.result == null) {
                KlinaraCard(title = "Birleştirilecek kayıt") {
                    KlinaraTextField(
                        label = "Ara",
                        value = state.term,
                        onValueChange = viewModel::search,
                        placeholder = "Ad veya telefon",
                    )

                    MergeCandidates(state = state, onSelect = viewModel::askMerge)
                }
            }
        }

        if (state.isMerging) AuthLoadingOverlay(message = "Birleştiriliyor…")
    }

    state.pending?.let { source ->
        val target = state.target.valueOrNull
        AlertDialog(
            onDismissRequest = viewModel::cancelMerge,
            title = { Text("Kayıtlar birleştirilsin mi?", style = KlinaraType.titleM) },
            text = {
                // İKİ kaydı da ADIYLA söylüyoruz: "emin misiniz?" diye soran ama neyi
                // sorduğunu söylemeyen bir diyalog, onay değil bir kabul tuşudur.
                Text(
                    "\"${source.fullName}\" arşivlenecek ve tüm kayıtları " +
                        "\"${target?.fullName ?: "bu karta"}\" taşınacak. Bu işlem geri alınamaz.",
                    style = KlinaraType.bodyM,
                )
            },
            confirmButton = { TextButton(onClick = viewModel::confirmMerge) { Text("Birleştir") } },
            dismissButton = { TextButton(onClick = viewModel::cancelMerge) { Text("Vazgeç") } },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        )
    }
}

@Composable
private fun MergeResultCard(summary: String?) {
    KlinaraCard(title = "Birleştirildi") {
        Text(
            // Hiçbir kayıt taşınmadıysa bunu SÖYLÜYORUZ: sessiz bir başarı, kullanıcıya
            // işlemin yapılıp yapılmadığını sorgulatırdı.
            text = summary?.let { "$it taşındı." } ?: "Taşınacak kayıt yoktu.",
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoal,
        )
    }
}

@Composable
private fun MergeCandidates(
    state: CustomerMergeUiState,
    onSelect: (Customer) -> Unit,
) {
    val colors = KlinaraTheme.colors

    when (val results = state.results) {
        null ->
            Text(
                "Birleştirmek istediğiniz mükerrer kaydı aramak için en az 2 karakter girin.",
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
            )

        Loadable.Loading -> Text("Aranıyor…", style = KlinaraType.bodyM, color = colors.charcoalMuted)

        is Loadable.Failed -> ErrorBanner(message = results.message)

        is Loadable.Loaded ->
            if (results.value.isEmpty()) {
                Text(
                    "\"${state.term}\" için başka bir kayıt bulunamadı.",
                    style = KlinaraType.bodyM,
                    color = colors.charcoalMuted,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
                    results.value.forEach { candidate ->
                        KlinaraNavigationRow(
                            label = candidate.fullName,
                            value = candidate.phone?.let(PhoneNumber::pretty) ?: candidate.email,
                            onClick = { onSelect(candidate) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
    }
}
