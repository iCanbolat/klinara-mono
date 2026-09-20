package com.klinara.android.features.branches

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
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
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSelectableRow
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.designsystem.components.KlinaraToolbarAction
import com.klinara.android.designsystem.components.rememberUnsavedChangesGuard
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.branches.BranchDetail
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.networking.Loadable

/**
 * Şubeler (A7.4) — iOS `BranchListView` paritesi.
 *
 * `branch:read` görür; ekleme/düzenleme `branch:write` (owner). Satır yalnız yazma izniyle
 * tıklanabilir — okuyana açılan bir form, kaydedemeyeceği bir şey vaat ederdi (§5.7).
 */
@Composable
fun BranchListScreen(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    onOpen: (branchId: String) -> Unit,
    onCreate: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: BranchListViewModel =
        viewModel(key = "branch-list", factory = BranchListViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canWrite = session.can(Permissions.BRANCH_WRITE)

    LaunchedEffect(Unit) { viewModel.load() }

    KlinaraScreen(
        title = "Şubeler",
        modifier = modifier,
        onBack = onBack,
        trailing = {
            if (canWrite) KlinaraToolbarAction(contentDescription = "Yeni şube", onClick = onCreate)
        },
    ) {
        when (val branches = state) {
            Loadable.Loading ->
                KlinaraSkeleton(style = KlinaraSkeletonStyle.cardsShort)
            is Loadable.Failed ->
                ErrorBanner(message = branches.message, onRetry = if (branches.isRetryable) viewModel::load else null)
            is Loadable.Loaded ->
                if (branches.value.isEmpty()) {
                    EmptyStateView(
                        title = "Şube yok",
                        message = "Henüz şube eklenmemiş.",
                        icon = Icons.Filled.Place,
                        actionTitle = if (canWrite) "Yeni şube" else null,
                        onAction = if (canWrite) onCreate else null,
                    )
                } else {
                    KlinaraCard(
                        footnote =
                            if (canWrite) {
                                "Şube silinmez; pasife alınan şubede yeni randevu açılmaz, geçmiş kayıtlar korunur."
                            } else {
                                "Şubeleri yalnız işletme sahibi ekleyip düzenleyebilir."
                            },
                    ) {
                        branches.value.forEachIndexed { index, branch ->
                            if (index > 0) KlinaraDivider()
                            BranchRow(
                                branch = branch,
                                isSelected = branch.id == session.activeBranchId,
                                onClick = if (canWrite) ({ onOpen(branch.id) }) else null,
                            )
                        }
                    }
                }
        }
    }
}

@Composable
private fun BranchRow(
    branch: BranchDetail,
    isSelected: Boolean,
    onClick: (() -> Unit)?,
) {
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
        val detail = listOfNotNull(branch.slug, branch.address).joinToString(" · ")
        if (onClick != null) {
            KlinaraNavigationRow(label = branch.name, detail = detail, onClick = onClick)
        } else {
            KlinaraRow(label = branch.name, detail = detail)
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (!branch.isActive) KlinaraBadge("Pasif", tone = KlinaraBadgeTone.Muted)
            if (isSelected) KlinaraBadge("Seçili", tone = KlinaraBadgeTone.Positive)
        }
    }
}

/**
 * Şube oluşturma / düzenleme (A7.4) — iOS `BranchFormView` paritesi. "Kaydet" sayfanın
 * altında (A5 deseni); kirli taslakla geri dönüş onay ister; pasife alma ayrıca onaylanır.
 */
@Composable
fun BranchEditorScreen(
    container: ServiceContainer,
    branchId: String?,
    onBack: () -> Unit,
    onSaved: (BranchDetail) -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: BranchEditorViewModel =
        viewModel(
            key = "branch-editor-${branchId ?: "new"}",
            factory = BranchEditorViewModel.factory(container, branchId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val draft = state.draft
    val back = rememberUnsavedChangesGuard(isDirty = draft.isDirty && state.saved == null, onLeave = onBack)
    val zones = remember(draft.timezone) { timeZoneOptions(draft.timezone) }

    LaunchedEffect(Unit) { viewModel.load() }
    LaunchedEffect(state.saved) { state.saved?.let(onSaved) }

    Box {
        KlinaraScreen(
            title = if (branchId == null) "Yeni şube" else "Şubeyi düzenle",
            modifier = modifier,
            onBack = back,
        ) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }
            if (!state.loaded) {
                KlinaraSkeleton(style = KlinaraSkeletonStyle.formLong)
                return@KlinaraScreen
            }

            KlinaraCard(title = "Şube") {
                KlinaraTextField(
                    label = "Şube adı",
                    value = draft.name,
                    onValueChange = { value -> viewModel.update { it.withName(value) } },
                    placeholder = "İzmir Alsancak",
                    error = state.fieldErrors["name"],
                )
                if (draft.isCreate) {
                    KlinaraTextField(
                        label = "Şube kodu",
                        value = draft.slug,
                        onValueChange = { value -> viewModel.update { it.withSlug(value) } },
                        placeholder = "izmir-alsancak",
                        error = state.fieldErrors["slug"] ?: draft.slugError,
                    )
                    Text(
                        "Randevu bağlantılarında görünür; sonradan değiştirilemez.",
                        style = KlinaraType.bodyM,
                        color = KlinaraTheme.colors.charcoalMuted,
                    )
                } else {
                    KlinaraRow(label = "Şube kodu", value = draft.slug)
                }
            }

            KlinaraCard(title = "İletişim") {
                KlinaraTextField(
                    label = "Telefon",
                    value = draft.phone,
                    onValueChange = { value -> viewModel.update { it.copy(phone = value) } },
                    placeholder = "+90 212 000 00 00",
                    error = state.fieldErrors["phone"],
                    keyboardType = KeyboardType.Phone,
                )
                KlinaraTextField(
                    label = "Adres",
                    value = draft.address,
                    onValueChange = { value -> viewModel.update { it.copy(address = value) } },
                    placeholder = "Cadde, no, ilçe",
                    error = state.fieldErrors["address"],
                )
            }

            KlinaraCard(title = "Saat dilimi", footnote = "Randevu ve çalışma saatleri bu dilime göre tutulur.") {
                zones.forEach { zone ->
                    KlinaraSelectableRow(
                        title = zone,
                        isSelected = draft.timezone == zone,
                        onClick = { viewModel.update { it.copy(timezone = zone) } },
                    )
                }
            }

            if (!draft.isCreate) {
                KlinaraCard(
                    footnote = "Pasif şubede yeni randevu alınmaz ve şube menüsünde görünmez; geçmiş kayıtlar korunur.",
                ) {
                    KlinaraToggleRow(
                        label = "Aktif",
                        isOn = draft.isActive,
                        onToggle = { value -> viewModel.update { it.copy(isActive = value) } },
                    )
                }
            }

            KlinaraButton(
                title = if (draft.isCreate) "Oluştur" else "Kaydet",
                onClick = viewModel::save,
                enabled = draft.isValid && draft.isDirty,
                isLoading = state.isSaving,
            )
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }

    if (state.confirmsDeactivation) {
        AlertDialog(
            onDismissRequest = viewModel::cancelDeactivation,
            title = { Text("Şube pasife alınsın mı?", style = KlinaraType.titleM) },
            text = {
                Text(
                    "Bu şubede yeni randevu alınamaz. Mevcut randevular, müşteriler ve raporlar korunur; " +
                        "istediğiniz zaman yeniden aktif edebilirsiniz.",
                    style = KlinaraType.bodyM,
                )
            },
            confirmButton = { TextButton(onClick = viewModel::confirmSave) { Text("Pasife al") } },
            dismissButton = { TextButton(onClick = viewModel::cancelDeactivation) { Text("Vazgeç") } },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        )
    }
}

/**
 * Seçilebilir saat dilimleri — Türkiye kliniği için kısa bir liste; mevcut değer listede
 * yoksa (başka ülkeden açılmış şube) başa eklenir, seçim kaybolmaz.
 */
internal fun timeZoneOptions(current: String): List<String> =
    (listOf(current) + COMMON_ZONES).distinct()

private val COMMON_ZONES =
    listOf("Europe/Istanbul", "Europe/London", "Europe/Berlin", "Europe/Amsterdam", "Asia/Dubai", "Asia/Baku")
