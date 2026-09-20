package com.klinara.android.features.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.AuthLoadingOverlay
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraBottomSheet
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraReorderableColumn
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToggleRow
import com.klinara.android.designsystem.components.KlinaraToolbarAction
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.catalog.ServiceCategory
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.networking.Loadable

/**
 * Hizmet kategorileri (A7.1) — iOS `ServiceCategoryListView` paritesi.
 *
 * **Satır yalnız bir satır.** Önce her satırda chevron, yukarı ok ve aşağı ok yan yana
 * duruyor, altında da "Pasife al" düğmesi vardı: üç kategorilik bir listede on iki
 * dokunma hedefi. Sıralama artık basılı tutup sürüklemeyle yapılıyor (iOS'un yıllardır
 * yazılı olan ama arayüzde karşılığı olmayan dipnotu nihayet doğru), pasife alma ise
 * kategorinin kendi panelinde — yıkıcı bir aksiyon listede tek dokunuş uzaklıkta durmamalı.
 *
 * Editör bir `AlertDialog` değil alttan açılan bir panel: diyalogda yıkıcı aksiyona yer
 * yoktu ve o yüzden listeye taşınmıştı.
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
        KlinaraScreen(
            title = "Kategoriler",
            modifier = modifier,
            onBack = onBack,
            trailing = {
                if (canWrite) {
                    KlinaraToolbarAction(contentDescription = "Yeni kategori", onClick = viewModel::startCreate)
                }
                trailing?.invoke(this)
            },
        ) {
            state.error?.let { ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError) }

            when (val catalog = state.catalog) {
                Loadable.Loading ->
                    KlinaraSkeleton(style = KlinaraSkeletonStyle.rows)
                is Loadable.Failed ->
                    ErrorBanner(message = catalog.message, onRetry = if (catalog.isRetryable) viewModel::load else null)
                is Loadable.Loaded ->
                    if (state.categories.isEmpty()) {
                        EmptyStateView(
                            title = "Kategori yok",
                            message = "Hizmetler kategori altında gruplanır. Önce bir kategori ekleyin.",
                            icon = Icons.AutoMirrored.Filled.List,
                            actionTitle = if (canWrite) "Yeni kategori" else null,
                            onAction = if (canWrite) viewModel::startCreate else null,
                        )
                    } else {
                        CategoryCard(
                            categories = state.categories,
                            snapshot = catalog.value,
                            canWrite = canWrite,
                            onOpen = viewModel::startEdit,
                            onMove = viewModel::moveTo,
                        )
                    }
            }
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }

    state.draft?.let { draft ->
        // Panelde "Pasife al" gösterilmesi için düzenlenen kaydın kendisi lazım: taslak
        // yalnız formun alanlarını taşıyor, kategorinin aktifliğini liste biliyor.
        val editing = draft.id?.let { id -> state.categories.firstOrNull { it.id == id } }
        CategoryEditorSheet(
            draft = draft,
            editing = editing,
            error = state.draftError,
            fieldErrors = state.draftFieldErrors,
            canWrite = canWrite,
            isSaving = state.isSaving,
            onUpdate = viewModel::updateDraft,
            onSave = viewModel::saveDraft,
            onCancel = viewModel::cancelDraft,
            onDeactivate = { viewModel.askDeactivate(it) },
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
    onOpen: (ServiceCategory) -> Unit,
    onMove: (Int, Int) -> Unit,
) {
    KlinaraCard(
        footnote =
            if (canWrite) {
                "Sıralamak için basılı tutup sürükleyin. Sıra, hizmet listesinde ve randevu " +
                    "formunda grupların sırasıdır."
            } else {
                null
            },
    ) {
        KlinaraReorderableColumn(
            items = categories,
            key = ServiceCategory::id,
            onMove = onMove,
            isEnabled = canWrite,
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) { index, category ->
            if (index > 0) KlinaraDivider()
            KlinaraNavigationRow(
                label = category.name,
                value = "${snapshot.activeServiceCount(category.id)} hizmet",
                detail = category.slug,
                onClick = { onOpen(category) },
                modifier = Modifier.fillMaxWidth(),
            )
            if (!category.isActive) KlinaraBadge("Pasif", tone = KlinaraBadgeTone.Muted)
        }
    }
}

/**
 * Kategori paneli — oluşturma ve düzenleme.
 *
 * Pasife alma **burada**: listede her satırın altında duran bir "Pasife al" düğmesi, hem
 * listeyi okunmaz kılıyor hem de yıkıcı bir işlemi yanlışlıkla dokunulacak yere koyuyordu.
 * iOS `CategoryEditorSheet` ile aynı yer.
 */
@Composable
private fun CategoryEditorSheet(
    draft: CategoryForm,
    editing: ServiceCategory?,
    error: String?,
    fieldErrors: Map<String, String>,
    canWrite: Boolean,
    isSaving: Boolean,
    onUpdate: ((CategoryForm) -> CategoryForm) -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
    onDeactivate: (ServiceCategory) -> Unit,
) {
    val title =
        when {
            !draft.isEditing -> "Yeni kategori"
            canWrite -> "Kategoriyi düzenle"
            else -> "Kategori"
        }
    val deactivatable = editing?.takeIf { canWrite && it.isActive }

    KlinaraBottomSheet(
        title = title,
        onDismiss = onCancel,
        isDirty = draft.isDirty,
        confirmTitle = if (canWrite) "Kaydet" else null,
        canConfirm = draft.isValid && draft.isDirty,
        isSaving = isSaving,
        onConfirm = if (canWrite) onSave else null,
        dismissTitle = if (canWrite) "Vazgeç" else "Kapat",
        destructiveTitle = deactivatable?.let { "Pasife al" },
        onDestructive = deactivatable?.let { category -> { onDeactivate(category) } },
        destructiveNote = deactivatable?.let { "Aktif hizmeti olan kategori pasife alınamaz." },
    ) {
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
}
