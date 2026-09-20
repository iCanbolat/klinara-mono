package com.klinara.android.features.staff

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.KlinaraStepperRow
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.catalog.CatalogSnapshot
import com.klinara.android.features.catalog.ServiceForm
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.formatting.DurationFormat
import com.klinara.android.services.formatting.Money
import com.klinara.android.services.networking.Loadable

/**
 * Yetkinlikler (A7.2) — iOS `StaffServiceMatrixView` paritesi.
 *
 * Hizmetler kategoriye göre gruplu; her satırda "yapabilir" anahtarı, çok şubeli kiracıda
 * kapsam ve isteğe bağlı özel süre. `staff:write` yoksa kontroller pasif, "Kaydet" yok.
 */
@Composable
fun StaffServiceMatrixScreen(
    session: AppSession,
    container: ServiceContainer,
    staffId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: StaffServiceMatrixViewModel =
        viewModel(key = "staff-matrix-$staffId", factory = StaffServiceMatrixViewModel.factory(container, staffId))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canWrite = session.can(Permissions.STAFF_WRITE)

    LaunchedEffect(Unit) { viewModel.load() }

    Box {
        KlinaraScreen(title = "Yetkinlikler", modifier = modifier, onBack = onBack) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }

            when (val loaded = state.loaded) {
                Loadable.Loading ->
                    KlinaraSkeleton(style = KlinaraSkeletonStyle.rows)
                is Loadable.Failed ->
                    ErrorBanner(message = loaded.message, onRetry = if (loaded.isRetryable) viewModel::load else null)
                is Loadable.Loaded -> {
                    val draft = state.draft ?: return@KlinaraScreen
                    MatrixBody(
                        snapshot = loaded.value.second,
                        draft = draft,
                        branches = session.branches,
                        canWrite = canWrite,
                        didSave = state.didSave,
                        viewModel = viewModel,
                    )
                }
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }
}

@Composable
private fun MatrixBody(
    snapshot: CatalogSnapshot,
    draft: SkillMatrixDraft,
    branches: List<BranchSummary>,
    canWrite: Boolean,
    didSave: Boolean,
    viewModel: StaffServiceMatrixViewModel,
) {
    val active = snapshot.services.filter { it.isActive }.sortedBy { it.name }
    if (active.isEmpty()) {
        EmptyStateView(
            title = "Aktif hizmet yok",
            message = "Yetkinlik atayabilmek için önce katalogda hizmet tanımlayın.",
            icon = Icons.AutoMirrored.Filled.List,
        )
        return
    }

    Text(
        "İşaretli hizmetleri bu personel yapabilir. Yetkin olmadığı bir hizmetten randevu açılamaz.",
        style = KlinaraType.bodyM,
        color = KlinaraTheme.colors.charcoalMuted,
    )
    if (draft.dropped.isNotEmpty()) {
        // Sessizce silmek yerine söylüyoruz: sunucu pasif hizmete yetkinliği geri yazdırmıyor.
        Text(
            "Pasif hizmetlerdeki ${draft.dropped.size} yetkinlik bir sonraki kayıtta kaldırılır.",
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.danger,
        )
    }
    if (didSave) Text("Yetkinlikler kaydedildi.", style = KlinaraType.bodyM, color = KlinaraTheme.colors.sageDeep)

    snapshot.grouped(active).forEach { group ->
        KlinaraCard(title = group.title) {
            group.services.forEachIndexed { index, service ->
                if (index > 0) KlinaraDivider()
                SkillRow(
                    service = service,
                    row = draft.row(service.id),
                    branches = branches,
                    canWrite = canWrite,
                    viewModel = viewModel,
                )
            }
        }
    }

    if (canWrite) {
        KlinaraButton(
            title = "Kaydet",
            onClick = viewModel::save,
            enabled = draft.isDirty,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun SkillRow(
    service: ClinicService,
    row: SkillMatrixDraft.Row,
    branches: List<BranchSummary>,
    canWrite: Boolean,
    viewModel: StaffServiceMatrixViewModel,
) {
    val detail =
        buildList {
            add("${DurationFormat.format(service.durationMinutes)} · ${Money.format(service.priceMinor)}")
            if (row.extraScopes > 0) add("+${row.extraScopes} şube kapsamı daha")
        }.joinToString(" · ")
    KlinaraToggleRow(
        label = service.name,
        detail = detail,
        isOn = row.isEnabled,
        onToggle = { on -> viewModel.update { it.toggle(service.id, on) } },
        enabled = canWrite,
    )
    if (!row.isEnabled) return

    // Tek şubeli kiracıda kapsam sorusu yok: "tüm şubeler" ile "bu şube" aynı şey.
    if (branches.size > 1) {
        KlinaraSegmentedPicker(
            options = listOf<String?>(null) + branches.map { it.id },
            selected = row.branchId,
            onSelect = { value -> if (canWrite) viewModel.update { it.withScope(service.id, value) } },
            title = { id -> if (id == null) "Tüm şubeler" else branches.firstOrNull { it.id == id }?.name ?: "Şube" },
            modifier = Modifier.fillMaxWidth(),
        )
    }
    val custom = row.customDurationMinutes
    KlinaraToggleRow(
        label = "Bu personel için özel süre",
        detail = if (custom == null) "Hizmetin kendi süresi kullanılıyor" else null,
        isOn = custom != null,
        onToggle = { on ->
            viewModel.update { it.withCustomDuration(service.id, if (on) service.durationMinutes else null) }
        },
        enabled = canWrite,
    )
    if (custom != null) {
        KlinaraStepperRow(
            label = "Süre",
            value = custom,
            onValueChange = { value -> viewModel.update { it.withCustomDuration(service.id, value) } },
            range = ServiceForm.DURATION_RANGE,
            step = ServiceForm.MINUTE_STEP,
            enabled = canWrite,
            format = DurationFormat::format,
        )
    }
}
