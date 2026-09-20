package com.klinara.android.features.customers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
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
import com.klinara.android.designsystem.components.ColorSwatchPicker
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraNavigationRow
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.KlinaraTextField
import com.klinara.android.designsystem.components.KlinaraToolbarAction
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.crm.CustomerTag
import com.klinara.android.services.networking.Loadable

/**
 * Müşteri etiketleri — Yönetim sekmesinden erişilir.
 *
 * `customer:read` görür, `customer:write` değiştirir. Yazma izni olmayanda satırlar
 * tıklanamaz ve "yeni etiket" düğmesi hiç çizilmez (§7.4).
 */
@Composable
fun CustomerTagListScreen(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val viewModel: CustomerTagListViewModel =
        viewModel(key = "customer-tags", factory = CustomerTagListViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canWrite = session.can(Permissions.CUSTOMER_WRITE)

    LaunchedEffect(Unit) { viewModel.load() }

    Box {
        KlinaraScreen(
            title = "Müşteri etiketleri",
            modifier = modifier,
            onBack = onBack,
            trailing = {
                if (canWrite) {
                    KlinaraToolbarAction(contentDescription = "Yeni etiket", onClick = viewModel::startCreate)
                }
                trailing?.invoke(this)
            },
        ) {
            state.error?.let {
                ErrorBanner(message = it, retryLabel = "Kapat", onRetry = viewModel::dismissError)
            }

            TagListBody(
                tags = state.tags,
                canWrite = canWrite,
                onEdit = viewModel::startEdit,
                onCreate = viewModel::startCreate,
                onRetry = viewModel::load,
            )
        }

        if (state.isSaving) AuthLoadingOverlay(message = "Kaydediliyor…")
    }

    state.draft?.let { draft ->
        TagEditorDialog(
            draft = draft,
            onNameChange = { value -> viewModel.updateDraft { it.copy(name = value) } },
            onColorChange = { value -> viewModel.updateDraft { it.copy(color = value) } },
            onSave = viewModel::saveDraft,
            onCancel = viewModel::cancelDraft,
            onDelete =
                draft.id?.let { id ->
                    {
                        val tag = state.tags.valueOrNull?.firstOrNull { it.id == id }
                        // Silme onayı listedeki diyaloga devrediliyor: sheet önce
                        // kapanmalı, yoksa iki diyalog üst üste biner.
                        viewModel.cancelDraft()
                        tag?.let(viewModel::askDelete)
                    }
                },
        )
    }

    state.pendingDelete?.let { tag ->
        AlertDialog(
            onDismissRequest = viewModel::cancelDelete,
            title = { Text("Etiket silinsin mi?", style = KlinaraType.titleM) },
            text = {
                Text(
                    "\"${tag.name}\" silinecek ve bu etiketi taşıyan tüm müşterilerden kaldırılacak.",
                    style = KlinaraType.bodyM,
                )
            },
            confirmButton = { TextButton(onClick = viewModel::confirmDelete) { Text("Sil") } },
            dismissButton = { TextButton(onClick = viewModel::cancelDelete) { Text("Vazgeç") } },
            containerColor = KlinaraTheme.colors.surfaceRaised,
        )
    }
}

@Composable
private fun TagListBody(
    tags: Loadable<List<CustomerTag>>,
    canWrite: Boolean,
    onEdit: (CustomerTag) -> Unit,
    onCreate: () -> Unit,
    onRetry: () -> Unit,
) {
    when (tags) {
        Loadable.Loading ->
            KlinaraSkeleton(style = KlinaraSkeletonStyle.rows)

        is Loadable.Failed ->
            ErrorBanner(message = tags.message, onRetry = if (tags.isRetryable) onRetry else null)

        is Loadable.Loaded ->
            if (tags.value.isEmpty()) {
                EmptyStateView(
                    title = "Henüz etiket yok",
                    message =
                        if (canWrite) {
                            "Etiketler müşteri kartlarında seçilir. İlkini buradan tanımlayın."
                        } else {
                            "Bu kiracıda tanımlı müşteri etiketi bulunmuyor."
                        },
                    icon = Icons.Filled.Info,
                    actionTitle = if (canWrite) "Yeni etiket" else null,
                    onAction = if (canWrite) onCreate else null,
                )
            } else {
                KlinaraCard(
                    title = "Etiketler",
                    footnote =
                        "Etiket adları büyük/küçük harf ve Türkçe karakter farkı " +
                            "gözetmeden tekildir: \"VIP\" ile \"vıp\" aynı sayılır.",
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
                        tags.value.forEach { tag ->
                            KlinaraNavigationRow(
                                label = tag.name,
                                value = tag.color ?: "Renksiz",
                                onClick = { onEdit(tag) },
                                enabled = canWrite,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
            }
    }
}

@Composable
private fun TagEditorDialog(
    draft: CustomerTagDraft,
    onNameChange: (String) -> Unit,
    onColorChange: (String?) -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
    onDelete: (() -> Unit)?,
) {
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(if (draft.id == null) "Yeni etiket" else "Etiketi düzenle", style = KlinaraType.titleM) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md)) {
                KlinaraTextField(
                    label = "Ad",
                    value = draft.name,
                    onValueChange = onNameChange,
                    placeholder = "VIP",
                )
                ColorSwatchPicker(selected = draft.color, onSelect = onColorChange)
                onDelete?.let {
                    KlinaraButton(
                        title = "Etiketi sil",
                        onClick = it,
                        kind = KlinaraButtonKind.Tertiary,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onSave, enabled = draft.isValid) { Text("Kaydet") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Vazgeç") } },
        containerColor = KlinaraTheme.colors.surfaceRaised,
    )
}
