package com.klinara.android.features.catalog

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.ColorDot
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.FabContentClearance
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraCheckMenuItem
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraFab
import com.klinara.android.designsystem.components.KlinaraFabBox
import com.klinara.android.designsystem.components.KlinaraIcons
import com.klinara.android.designsystem.components.KlinaraOverflowMenu
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSearchField
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.calendar.accentColor
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.DurationFormat
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.launch

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
 * iOS paritesi: şube seçici ve "⋮" (Pasifleri göster) üst çubukta, "Yeni hizmet" FAB'da,
 * pasife alma satırı sola kaydırarak. Kaydırma jesti TalkBack kullanıcısına görünmez
 * (A5.1), bu yüzden aynı işlem satıra özel erişilebilirlik aksiyonu olarak da duyurulur.
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

    var query by rememberSaveable { mutableStateOf("") }
    var showsInactive by rememberSaveable { mutableStateOf(false) }

    KlinaraFabBox(
        fab = if (canWrite) ({ KlinaraFab(contentDescription = "Yeni hizmet", onClick = { onOpen(null) }) }) else null,
        modifier = modifier,
    ) {
        KlinaraScreen(
            title = "Hizmetler",
            onBack = onBack,
            verticalSpacing = KlinaraMetrics.md,
            trailing = {
                trailing?.invoke(this)
                KlinaraOverflowMenu { dismiss ->
                    KlinaraCheckMenuItem(label = "Pasifleri göster", isChecked = showsInactive, onToggle = {
                        showsInactive = it
                        dismiss()
                    })
                }
            },
        ) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }

            when (val catalog = state.catalog) {
                Loadable.Loading ->
                    KlinaraSkeleton(style = KlinaraSkeletonStyle.rows)
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
                            iconRes = KlinaraIcons.services,
                            actionTitle = if (canWrite) "Yeni hizmet" else null,
                            onAction = if (canWrite) ({ onOpen(null) }) else null,
                        )
                    } else {
                        CatalogBody(
                            query = query,
                            onQueryChange = { query = it },
                            showsInactive = showsInactive,
                            snapshot = catalog.value,
                            session = session,
                            canWrite = canWrite,
                            onOpen = { onOpen(it.id) },
                            onDeactivate = viewModel::askDeactivate,
                        )
                    }
            }

            if (canWrite) Spacer(Modifier.height(FabContentClearance))
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
    query: String,
    onQueryChange: (String) -> Unit,
    showsInactive: Boolean,
    snapshot: CatalogSnapshot,
    session: AppSession,
    canWrite: Boolean,
    onOpen: (ClinicService) -> Unit,
    onDeactivate: (ClinicService) -> Unit,
) {
    val branchId = session.activeBranchId

    KlinaraSearchField(value = query, onValueChange = onQueryChange, placeholder = "Hizmet ara")

    val groups = snapshot.grouped(snapshot.filtered(query, showsInactive, branchId))
    if (groups.isEmpty()) {
        Text("Aramanızla eşleşen hizmet yok.", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
        return
    }
    groups.forEach { group ->
        KlinaraCard(title = group.title) {
            group.services.forEachIndexed { index, service ->
                if (index > 0) KlinaraDivider()
                val deactivate = if (canWrite && service.isActive) ({ onDeactivate(service) }) else null
                SwipeToDeactivate(onDeactivate = deactivate) {
                    ServiceRow(
                        service = service,
                        branchId = branchId,
                        onClick = { onOpen(service) },
                        onDeactivate = deactivate,
                    )
                }
            }
        }
    }
}

/**
 * Sola kaydırınca "Pasife al" — iOS `swipeActions` paritesi. Satır hiçbir zaman kendiliğinden
 * kaybolmaz: kaydırma yalnız onay diyaloğunu açar ve satır yerine geri döner.
 */
@Composable
private fun SwipeToDeactivate(
    onDeactivate: (() -> Unit)?,
    content: @Composable () -> Unit,
) {
    if (onDeactivate == null) {
        content()
        return
    }
    val colors = KlinaraTheme.colors
    val dismissState = rememberSwipeToDismissBoxState()
    val scope = rememberCoroutineScope()
    SwipeToDismissBox(
        state = dismissState,
        enableDismissFromStartToEnd = false,
        onDismiss = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart) onDeactivate()
            scope.launch { dismissState.reset() }
        },
        backgroundContent = {
            Box(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .background(colors.danger, RoundedCornerShape(KlinaraMetrics.controlRadius))
                        .padding(horizontal = KlinaraMetrics.md),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Text("Pasife al", style = KlinaraType.bodyEmphasis, color = colors.surfaceRaised)
            }
        },
    ) {
        Box(modifier = Modifier.background(colors.surfaceRaised)) { content() }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ServiceRow(
    service: ClinicService,
    branchId: String?,
    onClick: () -> Unit,
    onDeactivate: (() -> Unit)?,
) {
    val colors = KlinaraTheme.colors
    val effective = service.effective(branchId)
    val interaction = remember { MutableInteractionSource() }

    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .klinaraClickable(true, Role.Button, interaction, onClick)
                .semantics {
                    if (onDeactivate != null) {
                        customActions = listOf(CustomAccessibilityAction("Pasife al") { onDeactivate(); true })
                    }
                }.padding(vertical = KlinaraMetrics.sm),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
    ) {
        // Renk tek başına anlam taşımaz (WCAG 1.4.1): ad ve rozetler metin olarak var.
        ColorDot(
            color = accentColor(service.calendarColor, colors.border),
            modifier = Modifier.padding(top = 5.dp),
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
            Text(service.name, style = KlinaraType.bodyEmphasis, color = colors.charcoal)
            Text(durationSummary(effective), style = KlinaraType.bodyM, color = colors.charcoalMuted)
            if (effective.isOverridden || !effective.isActive || effective.isOnlineBookable) {
                FlowRow(
                    modifier = Modifier.padding(top = KlinaraMetrics.xs),
                    horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
                    verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
                ) {
                    if (effective.isOverridden) KlinaraBadge("Şubeye özel")
                    if (!effective.isActive) KlinaraBadge("Pasif", tone = KlinaraBadgeTone.Muted)
                    if (effective.isOnlineBookable) KlinaraBadge("Online", tone = KlinaraBadgeTone.Positive)
                }
            }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
        ) {
            Text(Money.format(effective.priceMinor), style = KlinaraType.bodyEmphasis, color = colors.charcoal)
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = colors.charcoalMuted,
                modifier = Modifier.size(20.dp),
            )
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
