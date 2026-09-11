package com.klinara.android.features.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ColorDot
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.calendar.accentColor
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.DurationFormat
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.networking.Loadable

/**
 * Hizmet kataloğu (A7.1) — iOS `ServiceListView` paritesi.
 *
 * Satırlar **seçili şubenin geçerli değerlerini** gösterir (şube farkı varsa süre ve fiyat
 * o şubeninki, "Şubeye özel" rozetiyle): yönetici hangi şubeye bakıyorsa oradaki
 * gerçekliği görmeli.
 *
 * `service:read` görür, `service:write` değiştirir. Yazma izni yoksa "Yeni hizmet" ve
 * "Pasife al" HİÇ çizilmez; satır yine açılır ama editör salt okunur.
 *
 * **iOS'tan sapma:** pasife alma `swipeActions` değil, kartın içinde açık bir düğme (A5.1
 * gerekçesi: kaydırma jesti TalkBack kullanıcısına görünmez).
 */
@Composable
fun ServiceListScreen(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    onOpen: (serviceId: String?) -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val viewModel: ServiceListViewModel =
        viewModel(key = "service-list", factory = ServiceListViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canWrite = session.can(Permissions.SERVICE_WRITE)

    // Editörden dönüşte de koşar (gezinme bu ekranı yeniden kurar) ve sessizce tazeler.
    LaunchedEffect(Unit) { viewModel.ensureLoaded() }

    Box {
        KlinaraScreen(title = "Hizmetler", modifier = modifier, onBack = onBack, trailing = trailing) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }

            when (val catalog = state.catalog) {
                Loadable.Loading ->
                    Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
                is Loadable.Failed ->
                    ErrorBanner(
                        message = catalog.message,
                        onRetry = if (catalog.isRetryable) viewModel::reload else null,
                    )
                is Loadable.Loaded ->
                    if (catalog.value.services.isEmpty()) {
                        EmptyStateView(
                            title = "Henüz hizmet yok",
                            message =
                                if (canWrite) {
                                    "İlk hizmeti ekleyerek başlayın. Süre ve hazırlık payı takvimde " +
                                        "doğrudan kullanılır."
                                } else {
                                    "Hizmet eklemek için yöneticinizle görüşün."
                                },
                            icon = Icons.AutoMirrored.Filled.List,
                        )
                    } else {
                        CatalogBody(
                            snapshot = catalog.value,
                            session = session,
                            canWrite = canWrite,
                            onOpen = { onOpen(it.id) },
                            onDeactivate = viewModel::askDeactivate,
                        )
                    }
            }

            if (canWrite) {
                KlinaraButton(
                    title = "Yeni hizmet",
                    onClick = { onOpen(null) },
                    kind = KlinaraButtonKind.Secondary,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }

    state.pendingDeactivation?.let { service ->
        AlertDialog(
            onDismissRequest = viewModel::cancelDeactivate,
            title = { Text("Hizmet pasife alınsın mı?", style = KlinaraType.titleM) },
            text = {
                Text(
                    "\"${service.name}\" silinmez, pasife alınır. Geçmiş randevular ve paketler etkilenmez; " +
                        "hizmet yeni randevularda seçilemez.",
                    style = KlinaraType.bodyM,
                )
            },
            confirmButton = { TextButton(onClick = viewModel::confirmDeactivate) { Text("Pasife al") } },
            dismissButton = { TextButton(onClick = viewModel::cancelDeactivate) { Text("Vazgeç") } },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        )
    }
}

@Composable
private fun CatalogBody(
    snapshot: CatalogSnapshot,
    session: AppSession,
    canWrite: Boolean,
    onOpen: (ClinicService) -> Unit,
    onDeactivate: (ClinicService) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var showsInactive by rememberSaveable { mutableStateOf(false) }
    val branchId = session.activeBranchId

    KlinaraTextField(label = "Hizmet ara", value = query, onValueChange = { query = it })
    KlinaraToggleRow(label = "Pasifleri göster", isOn = showsInactive, onToggle = { showsInactive = it })

    val groups = snapshot.grouped(snapshot.filtered(query, showsInactive, branchId))
    if (groups.isEmpty()) {
        Text("Aramanızla eşleşen hizmet yok.", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
        return
    }
    groups.forEach { group ->
        KlinaraCard(title = group.title) {
            group.services.forEachIndexed { index, service ->
                if (index > 0) KlinaraDivider()
                ServiceRow(service = service, branchId = branchId, onClick = { onOpen(service) })
                if (canWrite && service.isActive) {
                    KlinaraButton(
                        title = "Pasife al",
                        onClick = { onDeactivate(service) },
                        kind = KlinaraButtonKind.Tertiary,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ServiceRow(
    service: ClinicService,
    branchId: String?,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val effective = service.effective(branchId)
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
        KlinaraNavigationRow(
            label = service.name,
            value = Money.format(effective.priceMinor),
            detail = durationSummary(effective),
            onClick = onClick,
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Renk tek başına anlam taşımaz (WCAG 1.4.1): ad ve rozetler metin olarak var.
            ColorDot(color = accentColor(service.calendarColor, colors.border))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
                verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
            ) {
                if (effective.isOverridden) KlinaraBadge("Şubeye özel")
                if (!effective.isActive) KlinaraBadge("Pasif", tone = KlinaraBadgeTone.Muted)
                if (effective.isOnlineBookable) KlinaraBadge("Online", tone = KlinaraBadgeTone.Positive)
            }
        }
    }
}

/** "45 dk" ya da tampon varsa "45 dk · takvimde 1 sa". */
internal fun durationSummary(effective: ClinicService.Effective): String {
    val duration = DurationFormat.format(effective.durationMinutes)
    return if (effective.occupiedMinutes == effective.durationMinutes) {
        duration
    } else {
        "$duration · takvimde ${DurationFormat.format(effective.occupiedMinutes)}"
    }
}
