package com.klinara.android.features.customers

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.crm.CustomerNoteRevision
import com.klinara.android.services.formatting.BranchClock

/**
 * Not editörünün gezinme kabuğu.
 *
 * `CustomerRecordViewModel` **hedef başına yeniden kuruluyor** ve bu bilinçli bir
 * maliyet: alternatif, kart hedefindeki ViewModel'i paylaşmaktı
 * (`navController.getBackStackEntry`) ve o da bir ekranın ömrünü başka bir ekranın
 * geri yığını konumuna bağlardı. Not kaydedilince kart zaten kendi verisini
 * tazeliyor (geri dönüşte `LaunchedEffect` yeniden koşuyor).
 */
@Composable
fun NoteEditorHost(
    session: AppSession,
    container: ServiceContainer,
    customerId: String,
    noteId: String?,
    onBack: () -> Unit,
    onOpenRevisions: (customerId: String, noteId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: CustomerRecordViewModel =
        viewModel(
            key = "note-editor-$customerId",
            factory =
                CustomerRecordViewModel.factory(
                    container = container,
                    customerId = customerId,
                    canReadMedical = session.can(Permissions.CUSTOMER_MEDICAL_READ),
                    canWriteMedical = session.can(Permissions.CUSTOMER_MEDICAL_WRITE),
                ),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    var saved by remember { mutableStateOf(false) }

    LaunchedEffect(customerId) { viewModel.load() }
    // Kaydetme bitince geri dön: `isSaving` düştüğü an hata yoksa iş tamamdır.
    LaunchedEffect(state.isSaving, state.error) {
        if (saved && !state.isSaving && state.error == null) onBack()
    }

    val note = noteId?.let(viewModel::note)

    NoteEditorScreen(
        note = note,
        canWriteMedical = viewModel.canWriteMedical,
        currentVersion = note?.version,
        isSaving = state.isSaving,
        error = state.error,
        onDismissError = viewModel::dismissError,
        onSave = { body, kind, visible, openedVersion ->
            saved = true
            if (noteId == null || openedVersion == null) {
                viewModel.createNote(body, kind, visible)
            } else {
                viewModel.updateNote(noteId, openedVersion, body, kind, visible)
            }
        },
        onDelete =
            noteId?.let { id ->
                {
                    saved = true
                    viewModel.deleteNote(id)
                }
            },
        onOpenRevisions = noteId?.let { id -> { onOpenRevisions(customerId, id) } },
        onBack = onBack,
        modifier = modifier,
    )
}

/** Revizyon listesi kabuğu. */
@Composable
fun NoteRevisionsHost(
    session: AppSession,
    container: ServiceContainer,
    customerId: String,
    noteId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: CustomerRecordViewModel =
        viewModel(
            key = "note-revisions-$noteId",
            factory =
                CustomerRecordViewModel.factory(
                    container = container,
                    customerId = customerId,
                    canReadMedical = session.can(Permissions.CUSTOMER_MEDICAL_READ),
                    canWriteMedical = session.can(Permissions.CUSTOMER_MEDICAL_WRITE),
                ),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }
    var revisions by remember(noteId) { mutableStateOf<List<CustomerNoteRevision>>(emptyList()) }

    LaunchedEffect(customerId) { viewModel.load() }
    LaunchedEffect(noteId, state.notes) {
        viewModel.revisions(noteId).onSuccess { revisions = it }
    }

    NoteRevisionsScreen(
        current = viewModel.note(noteId),
        revisions = revisions,
        onBack = onBack,
        modifier = modifier,
        formatDate = clock::formatDateTime,
    )
}
