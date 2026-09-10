package com.klinara.android.features.customers.files

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
import com.klinara.android.services.files.FileKind
import com.klinara.android.services.files.FilePosition
import okhttp3.OkHttpClient

/**
 * Dosya ekranlarının gezinme kabukları.
 *
 * Her hedef kendi `CustomerFilesViewModel`'ini kuruyor — `NoteEditorHost` ile aynı
 * gerekçe: paylaşmak, bir ekranın ömrünü başka bir ekranın geri yığını konumuna
 * bağlardı. Geri dönüşte kart zaten kendi listesini tazeliyor.
 */
@Composable
fun FileUploadHost(
    container: ServiceContainer,
    customerId: String,
    isPhoto: Boolean,
    groupId: String?,
    position: FilePosition?,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: CustomerFilesViewModel =
        viewModel(
            key = "file-upload-$customerId",
            factory = CustomerFilesViewModel.factory(container, customerId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    var started by remember { mutableStateOf(false) }

    LaunchedEffect(customerId) { viewModel.load() }
    // Yükleme bitince geri dön; hata varsa ekranda kal ki kullanıcı sebebini görsün.
    LaunchedEffect(state.uploadStep, state.error) {
        if (started && state.uploadStep == null && state.error == null) onBack()
    }

    FileUploadSheet(
        kind = if (isPhoto) FileKind.Photo else FileKind.Document,
        presetGroupId = groupId,
        presetPosition = position,
        isUploading = state.isUploading,
        error = state.error,
        onDismissError = viewModel::dismissError,
        onUpload = { data, contentType, selectedPosition, selectedGroup ->
            started = true
            viewModel.upload(
                data = data,
                contentType = contentType,
                kind = if (isPhoto) FileKind.Photo else FileKind.Document,
                position = selectedPosition,
                groupId = selectedGroup,
            )
        },
        onBack = onBack,
        modifier = modifier,
    )
}

@Composable
fun PhotoGroupsHost(
    session: AppSession,
    container: ServiceContainer,
    customerId: String,
    onOpenPhoto: (String) -> Unit,
    onAddToSlot: (groupId: String, position: FilePosition) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: CustomerFilesViewModel =
        viewModel(
            key = "photo-groups-$customerId",
            factory = CustomerFilesViewModel.factory(container, customerId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(customerId) { viewModel.load() }

    PhotoGroupsScreen(
        groups = state.groups,
        thumbnails = viewModel.thumbnails,
        canWriteMedical = session.can(Permissions.CUSTOMER_MEDICAL_WRITE),
        error = state.error,
        onDismissError = viewModel::dismissError,
        onOpenPhoto = onOpenPhoto,
        onAddToSlot = onAddToSlot,
        onCreateGroup = viewModel::createGroup,
        onBack = onBack,
        modifier = modifier,
    )
}

@Composable
fun PhotoDetailHost(
    session: AppSession,
    container: ServiceContainer,
    customerId: String,
    fileId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: CustomerFilesViewModel =
        viewModel(
            key = "photo-detail-$customerId",
            factory = CustomerFilesViewModel.factory(container, customerId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val http = remember { OkHttpClient() }
    var deleted by remember { mutableStateOf(false) }

    LaunchedEffect(customerId) { viewModel.load() }
    LaunchedEffect(deleted) { if (deleted) onBack() }

    PhotoDetailScreen(
        file = state.files.valueOrNull?.firstOrNull { it.id == fileId },
        files = container.files,
        http = http,
        canDelete = session.can(Permissions.CUSTOMER_MEDICAL_WRITE),
        onDelete = {
            viewModel.delete(it)
            deleted = true
        },
        onBack = onBack,
        modifier = modifier,
    )
}

@Composable
fun DocumentPreviewHost(
    container: ServiceContainer,
    customerId: String,
    fileId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: CustomerFilesViewModel =
        viewModel(
            key = "document-preview-$customerId",
            factory = CustomerFilesViewModel.factory(container, customerId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val http = remember { OkHttpClient() }

    LaunchedEffect(customerId) { viewModel.load() }

    DocumentPreviewScreen(
        file = state.files.valueOrNull?.firstOrNull { it.id == fileId },
        files = container.files,
        http = http,
        onBack = onBack,
        modifier = modifier,
    )
}
