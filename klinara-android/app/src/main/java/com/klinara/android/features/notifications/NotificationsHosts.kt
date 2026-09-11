package com.klinara.android.features.notifications

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.features.auth.AppSession
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
        onChannel = viewModel::setChannel,
        onEvent = viewModel::toggleEvent,
        onRetry = viewModel::load,
        onLoadMore = viewModel::loadMore,
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
