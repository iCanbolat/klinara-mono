package com.klinara.android.features.integrations

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.notifications.rememberBranchClock
import com.klinara.android.features.scheduling.rememberUnsavedChangesGuard
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.networking.Loadable

/** WhatsApp hedeflerinin dördü de ayar ekranının ViewModel'ini paylaşır ([owner]). */
@Composable
private fun whatsAppViewModel(
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
): WhatsAppViewModel =
    viewModel(viewModelStoreOwner = owner, key = "whatsapp", factory = WhatsAppViewModel.factory(container))

@Suppress("LongParameterList")
@Composable
fun WhatsAppSettingsHost(
    session: AppSession,
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
    onEdit: () -> Unit,
    onOpenTemplates: () -> Unit,
    onTest: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel = whatsAppViewModel(container, owner)
    val state by viewModel.state.collectAsStateWithLifecycle()
    // Yalnız ilk açılışta; editörden dönüşte hesap `accountSaved` ile zaten güncel.
    LaunchedEffect(Unit) { if (state.account !is Loadable.Loaded) viewModel.load() }

    WhatsAppSettingsScreen(
        state = state,
        clock = rememberBranchClock(session),
        actions =
            WhatsAppSettingsActions(
                onRetry = viewModel::load,
                onVerify = viewModel::verify,
                onEdit = onEdit,
                onOpenTemplates = onOpenTemplates,
                // Test gönderimi `notification:send`; yoksa düğme hiç çizilmez (§7.4).
                onTest = onTest.takeIf { session.can(Permissions.NOTIFICATION_SEND) },
                onDismissError = viewModel::dismissError,
            ),
        onBack = onBack,
        modifier = modifier,
    )
}

@Composable
fun WhatsAppEditorHost(
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shared = whatsAppViewModel(container, owner)
    val sharedState by shared.state.collectAsStateWithLifecycle()
    // Fabrika yalnız İLK kompozisyonda koşar: editör açıldığı andaki hesapla kurulur.
    val existing = sharedState.account.valueOrNull
    val viewModel: WhatsAppEditorViewModel =
        viewModel(key = "whatsapp-editor", factory = WhatsAppEditorViewModel.factory(container, existing))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val back = rememberUnsavedChangesGuard(isDirty = state.draft.isDirty && state.saved == null, onLeave = onBack)

    LaunchedEffect(state.saved) {
        state.saved?.let {
            shared.accountSaved(it)
            onBack()
        }
    }

    WhatsAppSettingsEditorScreen(
        state = state,
        onUpdate = viewModel::update,
        onSave = viewModel::save,
        onDismissError = viewModel::dismissError,
        onBack = back,
        modifier = modifier,
    )
}

@Composable
fun WhatsAppTemplatesHost(
    session: AppSession,
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel = whatsAppViewModel(container, owner)
    val state by viewModel.state.collectAsStateWithLifecycle()
    // Her girişte: iOS gibi — Meta'daki onay durumu değişmiş olabilir.
    LaunchedEffect(Unit) { viewModel.loadTemplates() }
    WhatsAppTemplateListScreen(
        templates = state.templates,
        clock = rememberBranchClock(session),
        onRetry = viewModel::loadTemplates,
        onBack = onBack,
        modifier = modifier,
    )
}

@Composable
fun WhatsAppTestHost(
    session: AppSession,
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Derin bağlantıyla gelinse bile izinsiz rol sunucuya 403 için gitmez.
    if (!session.can(Permissions.NOTIFICATION_SEND)) {
        LaunchedEffect(Unit) { onBack() }
        return
    }
    val shared by whatsAppViewModel(container, owner).state.collectAsStateWithLifecycle()
    val viewModel: WhatsAppTestViewModel =
        viewModel(key = "whatsapp-test", factory = WhatsAppTestViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()
    WhatsAppTestScreen(
        state = state,
        testable = shared.testableTemplates,
        hasAnyTemplate = shared.templates.valueOrNull.orEmpty().isNotEmpty(),
        onPhone = viewModel::setPhone,
        onSelect = viewModel::select,
        onSend = { viewModel.send(shared.testableTemplates) },
        onBack = onBack,
        modifier = modifier,
    )
}
