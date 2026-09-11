package com.klinara.android.features.notifications

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.integrations.InboxItem
import com.klinara.android.services.networking.Loadable

/**
 * Gelen kutusu (A8.1) — iOS `InboxView` paritesi.
 *
 * Uygulamadan **yanıt yazılamaz** (sunucuda giden serbest metin ucu yok) ve ekran bunu saklamaz.
 * "İşlendi olarak işaretle" yalnız `notification:send`; müşteri kartı bağlantısı sekmeler arası
 * gezinmeyle Müşteriler sekmesinde açılır ([onOpenCustomer] `null`sa — sekme yoksa — çizilmez).
 */
@Composable
fun InboxScreen(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    onOpenCustomer: ((String) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val viewModel: InboxViewModel = viewModel(key = "inbox", factory = InboxViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canHandle = session.can(Permissions.NOTIFICATION_SEND)
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }

    LaunchedEffect(Unit) { viewModel.load() }

    Box {
        KlinaraScreen(title = "Gelen kutusu", modifier = modifier, onBack = onBack) {
            KlinaraSegmentedPicker(
                options = InboxFilter.entries,
                selected = state.filter,
                onSelect = viewModel::setFilter,
                title = { it.title },
                modifier = Modifier.fillMaxWidth(),
            )
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }

            when (val items = state.items) {
                Loadable.Loading ->
                    Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
                is Loadable.Failed ->
                    ErrorBanner(message = items.message, onRetry = if (items.isRetryable) viewModel::load else null)
                is Loadable.Loaded ->
                    if (items.value.isEmpty()) {
                        val unhandled = state.filter == InboxFilter.Unhandled
                        EmptyStateView(
                            title = if (unhandled) "Bekleyen mesaj yok" else "Gelen mesaj yok",
                            message =
                                if (unhandled) {
                                    "İşlenmemiş bir mesaj kalmadı."
                                } else {
                                    "Müşteriler WhatsApp'tan yazdığında mesajlar burada görünür."
                                },
                            icon = Icons.Filled.Email,
                        )
                    } else {
                        KlinaraCard(
                            title = "Mesajlar",
                            // Sunucu bu uçta cursor VERMİYOR; "daha fazlası var" izlenimi vermemek için
                            // sınır açıkça söyleniyor.
                            footnote =
                                "En yeni mesajlar gösterilir. Uygulamadan yanıt yazılamaz; " +
                                    "müşteriye WhatsApp'tan dönün.",
                        ) {
                            items.value.forEachIndexed { index, item ->
                                if (index > 0) KlinaraDivider()
                                InboxRow(
                                    item = item,
                                    clock = clock,
                                    canHandle = canHandle,
                                    onHandle = { viewModel.markHandled(item.id) },
                                    onOpenCustomer = onOpenCustomer,
                                )
                            }
                        }
                    }
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InboxRow(
    item: InboxItem,
    clock: BranchClock,
    canHandle: Boolean,
    onHandle: () -> Unit,
    onOpenCustomer: ((String) -> Unit)?,
) {
    val colors = KlinaraTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
        // Numara ve rozetler tek satıra sığmıyor (iOS'ta da kartı taşırıyordu); akış satırı sarar.
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            Text(item.from, style = KlinaraType.bodyEmphasis, color = colors.charcoal)
            if (item.customerId == null) KlinaraBadge("Kayıtlı müşteri değil", tone = KlinaraBadgeTone.Muted)
            if (item.isHandled) KlinaraBadge("İşlendi", tone = KlinaraBadgeTone.Positive, icon = Icons.Filled.Check)
            if (item.messageType != "text") KlinaraBadge(item.messageTypeLabel)
        }
        Text(clock.formatDateTime(item.receivedAt), style = KlinaraType.bodyM, color = colors.charcoalMuted)
        Text(item.preview, style = KlinaraType.bodyM, color = colors.charcoal)

        FlowRow(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
            val customerId = item.customerId
            if (customerId != null && onOpenCustomer != null) {
                KlinaraButton(
                    title = "Müşteri kartı",
                    onClick = { onOpenCustomer(customerId) },
                    kind = KlinaraButtonKind.Tertiary,
                )
            }
            if (canHandle && !item.isHandled) {
                KlinaraButton(title = "İşlendi olarak işaretle", onClick = onHandle, kind = KlinaraButtonKind.Tertiary)
            }
        }
    }
}
