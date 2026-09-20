package com.klinara.android.features.notifications

import androidx.compose.foundation.layout.RowScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.features.auth.AppSession
import com.klinara.android.features.scheduling.NoBranchState
import com.klinara.android.designsystem.components.rememberUnsavedChangesGuard
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.formatting.BranchClock

/**
 * Mesaj günlüğü ve detayı TEK ViewModel'i paylaşır — [owner] günlük hedefinin geri yığını kaydı
 * (A5.4 `PackageReportsHost` emsali). Detay mesajı buradan okur; süzgeç ve sayfalar detaydan
 * dönüşte kaybolmaz.
 */
@Composable
fun MessageLogHost(
    session: AppSession,
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
    onOpen: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel = messageLogViewModel(container, owner)
    val state by viewModel.state.collectAsStateWithLifecycle()
    val clock = rememberBranchClock(session)

    LaunchedEffect(Unit) { viewModel.loadIfNeeded() }

    MessageLogScreen(
        state = state,
        clock = clock,
        onStatus = viewModel::setStatus,
        onToggleStatus = viewModel::toggleStatus,
        onEvent = viewModel::toggleEvent,
        onClearFilters = viewModel::clearFilters,
        onRetry = viewModel::load,
        onLoadMore = viewModel::loadMore,
        onRetryLoadMore = viewModel::retryLoadMore,
        onOpen = onOpen,
        onBack = onBack,
        modifier = modifier,
    )
}

@Composable
fun MessageDetailHost(
    session: AppSession,
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
    messageId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel = messageLogViewModel(container, owner)
    // Durum akışını dinlemek gerekmiyor: mesaj değişmez bir kayıt, açıldığı anki hâli yeterli.
    val message = remember(messageId) { viewModel.message(messageId) }
    val clock = rememberBranchClock(session)
    if (message == null) {
        MissingMessageScreen(onBack = onBack, modifier = modifier)
    } else {
        MessageDetailScreen(message = message, clock = clock, onBack = onBack, modifier = modifier)
    }
}

@Composable
private fun messageLogViewModel(
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
): MessageLogViewModel =
    viewModel(viewModelStoreOwner = owner, key = "message-log", factory = MessageLogViewModel.factory(container))

@Composable
internal fun rememberBranchClock(session: AppSession): BranchClock =
    remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }

/** Şablon listesi — editörle ViewModel'i PAYLAŞIR (sahibi liste hedefinin geri yığını girdisi). */
@Composable
fun NotificationTemplateListHost(
    session: AppSession,
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
    onOpen: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel = templatesViewModel(container, owner)
    val templates by viewModel.templates.collectAsStateWithLifecycle()
    // Editörden dönüşte de koşar: liste birleştirilmiş görünüm, yerel yamalamak bir varsayılanı
    // ezince listede iki satır bırakabilirdi (iOS gerekçesi).
    LaunchedEffect(Unit) { viewModel.load() }
    NotificationTemplateListScreen(
        templates = templates,
        canWrite = session.can(Permissions.NOTIFICATION_MANAGE),
        onOpen = onOpen,
        onRetry = viewModel::load,
        onBack = onBack,
        modifier = modifier,
    )
}

@Composable
fun NotificationTemplateEditorHost(
    session: AppSession,
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
    rowId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val list = templatesViewModel(container, owner)
    val row = remember(rowId) { list.row(rowId) }
    if (row == null) {
        LaunchedEffect(Unit) { onBack() }
        return
    }
    val canWrite = session.can(Permissions.NOTIFICATION_MANAGE)
    val viewModel: NotificationTemplateEditorViewModel =
        viewModel(
            key = "template-editor-$rowId",
            factory = NotificationTemplateEditorViewModel.factory(container, row.template),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val back = rememberUnsavedChangesGuard(isDirty = canWrite && state.form.isDirty && !state.saved, onLeave = onBack)

    LaunchedEffect(state.saved) { if (state.saved) onBack() }

    NotificationTemplateEditorScreen(
        state = state,
        row = row,
        canWrite = canWrite,
        onUpdate = viewModel::update,
        onSave = viewModel::save,
        onDismissError = viewModel::dismissError,
        onBack = back,
        modifier = modifier,
    )
}

@Composable
fun NotificationPreferenceListHost(
    session: AppSession,
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
    onOpen: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val viewModel = preferencesViewModel(container, owner)
    val preferences by viewModel.preferences.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.load() }
    NotificationPreferenceListScreen(
        preferences = preferences,
        branch = session.activeBranch,
        onOpen = onOpen,
        onRetry = viewModel::load,
        onBack = onBack,
        modifier = modifier,
        trailing = trailing,
    )
}

@Composable
fun NotificationPreferenceEditorHost(
    session: AppSession,
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
    rowId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val list = preferencesViewModel(container, owner)
    val preference = remember(rowId) { list.preference(rowId) }
    if (preference == null) {
        LaunchedEffect(Unit) { onBack() }
        return
    }
    val canWrite = session.can(Permissions.NOTIFICATION_MANAGE)
    val viewModel: NotificationPreferenceEditorViewModel =
        viewModel(
            key = "preference-editor-$rowId-${session.activeBranchId}",
            factory = NotificationPreferenceEditorViewModel.factory(container, preference, session.activeBranchId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val back = rememberUnsavedChangesGuard(isDirty = canWrite && state.draft.isDirty && !state.saved, onLeave = onBack)

    LaunchedEffect(state.saved) { if (state.saved) onBack() }

    NotificationPreferenceEditorScreen(
        state = state,
        preference = preference,
        branch = session.activeBranch,
        canWrite = canWrite,
        onUpdate = viewModel::update,
        onSave = viewModel::save,
        onDismissError = viewModel::dismissError,
        onBack = back,
        modifier = modifier,
    )
}

/** Hatırlatma ayarı ŞUBE kapsamlı: şube değişince ViewModel anahtarı değişir ve yeniden okunur. */
@Composable
fun ReminderSettingsHost(
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
) {
    val branch = session.activeBranch
    if (branch == null) {
        KlinaraScreen(title = "Hatırlatma ayarları", modifier = modifier, onBack = onBack, trailing = trailing) {
            NoBranchState("Hatırlatma ayarlarını görmek için bir şube seçin.")
        }
        return
    }
    val canWrite = session.can(Permissions.NOTIFICATION_MANAGE)
    val viewModel: ReminderSettingsViewModel =
        viewModel(
            key = "reminder-settings-${branch.id}",
            factory = ReminderSettingsViewModel.factory(container, branch.id),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val back = rememberUnsavedChangesGuard(isDirty = canWrite && state.draft?.isDirty == true, onLeave = onBack)

    LaunchedEffect(branch.id) { viewModel.load() }

    ReminderSettingsScreen(
        state = state,
        branch = branch,
        canWrite = canWrite,
        actions =
            ReminderSettingsActions(
                onRetry = viewModel::load,
                onUpdate = viewModel::updateDraft,
                onNewHourText = viewModel::setNewHourText,
                onAddHour = viewModel::addHour,
                onSave = viewModel::save,
                onAskReset = viewModel::askReset,
                onConfirmReset = viewModel::confirmReset,
                onCancelReset = viewModel::cancelReset,
                onDismissError = viewModel::dismissError,
            ),
        onBack = back,
        modifier = modifier,
        // Kirli taslakta şube değiştirmek düzenlemeyi başka şubenin ekranına taşırdı; menü gizlenir.
        trailing = trailing.takeIf { state.draft?.isDirty != true },
    )
}

@Composable
private fun templatesViewModel(
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
): NotificationTemplatesViewModel =
    viewModel(
        viewModelStoreOwner = owner,
        key = "notification-templates",
        factory = NotificationTemplatesViewModel.factory(container),
    )

@Composable
private fun preferencesViewModel(
    container: ServiceContainer,
    owner: ViewModelStoreOwner,
): NotificationPreferencesViewModel =
    viewModel(
        viewModelStoreOwner = owner,
        key = "notification-preferences",
        factory = NotificationPreferencesViewModel.factory(container),
    )
