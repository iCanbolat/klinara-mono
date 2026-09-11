package com.klinara.android.features.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
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
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.catalog.ServiceCategory
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.networking.Loadable

/**
 * Hizmet kategorileri (A7.1) — iOS `ServiceCategoryListView` paritesi.
 *
 * Sıra yukarı/aşağı düğmeleriyle değişir. iOS kartında "basılı tutup sürükleyin" dipnotu
 * var ama arayüzde sürükleme yok, düğme var — o dipnot burada **yazılmadı** (§7.8 notu).
 *
 * Editör bir diyalog (`CustomerTagListScreen` deseni): üç alanlık bir form için ayrı bir
 * gezinme hedefi fazla.
 */
@Composable
fun ServiceCategoryListScreen(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val viewModel: ServiceCategoryListViewModel =
        viewModel(key = "service-categories", factory = ServiceCategoryListViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canWrite = session.can(Permissions.SERVICE_WRITE)

    LaunchedEffect(Unit) { viewModel.load() }

    Box {
        KlinaraScreen(title = "Kategoriler", modifier = modifier, onBack = onBack, trailing = trailing) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }

            when (val catalog = state.catalog) {
                Loadable.Loading ->
                    Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
                is Loadable.Failed ->
                    ErrorBanner(message = catalog.message, onRetry = if (catalog.isRetryable) viewModel::load else null)
                is Loadable.Loaded ->
                    if (state.categories.isEmpty()) {
                        EmptyStateView(
                            title = "Kategori yok",
                            message = "Hizmetler kategori altında gruplanır. Önce bir kategori ekleyin.",
                            icon = Icons.AutoMirrored.Filled.List,
                        )
                    } else {
                        CategoryCard(
                            categories = state.categories,
                            snapshot = catalog.value,
                            canWrite = canWrite,
                            viewModel = viewModel,
                        )
                    }
            }

            if (canWrite) {
                KlinaraButton(
                    title = "Yeni kategori",
                    onClick = viewModel::startCreate,
                    kind = KlinaraButtonKind.Secondary,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }

    state.draft?.let { draft ->
        CategoryEditorDialog(
            draft = draft,
            error = state.draftError,
            fieldErrors = state.draftFieldErrors,
            canWrite = canWrite,
            onUpdate = viewModel::updateDraft,
            onSave = viewModel::saveDraft,
            onCancel = viewModel::cancelDraft,
        )
    }

    state.pendingDeactivation?.let { category ->
        AlertDialog(
            onDismissRequest = viewModel::cancelDeactivate,
            title = { Text("Kategori pasife alınsın mı?", style = KlinaraType.titleM) },
            text = {
                Text(
                    "\"${category.name}\" silinmez, pasife alınır. Bu kategorideki hizmetler listede kalır.",
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
private fun CategoryCard(
    categories: List<ServiceCategory>,
    snapshot: CatalogSnapshot,
    canWrite: Boolean,
    viewModel: ServiceCategoryListViewModel,
) {
    KlinaraCard(
        footnote =
            if (canWrite) {
                "Sıra, hizmet listesinde ve randevu formunda grupların sırasıdır. " +
                    "Aktif hizmeti olan kategori pasife alınamaz."
            } else {
                null
            },
    ) {
        categories.forEachIndexed { index, category ->
            if (index > 0) KlinaraDivider()
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
                    KlinaraNavigationRow(
                        label = category.name,
                        value = "${snapshot.activeServiceCount(category.id)} hizmet",
                        detail = category.slug,
                        onClick = { viewModel.startEdit(category) },
                    )
                    if (!category.isActive) KlinaraBadge("Pasif", tone = KlinaraBadgeTone.Muted)
                }
                if (canWrite) {
                    IconButton(onClick = { viewModel.move(category, -1) }, enabled = index > 0) {
                        Icon(Icons.Filled.KeyboardArrowUp, contentDescription = "${category.name} yukarı taşı")
                    }
                    IconButton(onClick = { viewModel.move(category, 1) }, enabled = index < categories.lastIndex) {
                        Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "${category.name} aşağı taşı")
                    }
                }
            }
            if (canWrite && category.isActive) {
                KlinaraButton(
                    title = "Pasife al",
                    onClick = { viewModel.askDeactivate(category) },
                    kind = KlinaraButtonKind.Tertiary,
                )
            }
        }
    }
}

@Composable
private fun CategoryEditorDialog(
    draft: CategoryForm,
    error: String?,
    fieldErrors: Map<String, String>,
    canWrite: Boolean,
    onUpdate: ((CategoryForm) -> CategoryForm) -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
) {
    val title =
        when {
            !draft.isEditing -> "Yeni kategori"
            canWrite -> "Kategoriyi düzenle"
            else -> "Kategori"
        }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(title, style = KlinaraType.titleM) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md)) {
                error?.let { ErrorBanner(message = it) }
                KlinaraTextField(
                    label = "Kategori adı",
                    value = draft.name,
                    onValueChange = { value -> onUpdate { it.withName(value) } },
                    placeholder = "Epilasyon",
                    error = fieldErrors["name"],
                    enabled = canWrite,
                )
                KlinaraTextField(
                    label = "Kod (slug)",
                    value = draft.slug,
                    onValueChange = { value -> onUpdate { it.withSlug(value) } },
                    placeholder = "epilasyon",
                    error = draft.slugError ?: fieldErrors["slug"],
                    enabled = canWrite,
                )
                KlinaraToggleRow(
                    label = "Aktif",
                    isOn = draft.isActive,
                    onToggle = { value -> onUpdate { it.copy(isActive = value) } },
                    enabled = canWrite,
                )
            }
        },
        confirmButton = {
            if (canWrite) {
                TextButton(onClick = onSave, enabled = draft.isValid && draft.isDirty) { Text("Kaydet") }
            }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text(if (canWrite) "Vazgeç" else "Kapat") } },
        containerColor = KlinaraTheme.colors.surfaceRaised,
    )
}
