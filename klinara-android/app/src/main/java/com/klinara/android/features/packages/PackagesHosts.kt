package com.klinara.android.features.packages

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.formatting.BranchClock

/**
 * Paket ekranlarının gezinme kabukları (`FilesHosts` deseni).
 *
 * Her hedef KENDİ ViewModel'ini kurar: paylaşmak bir ekranın ömrünü başka bir ekranın
 * geri yığını konumuna bağlardı. Geri dönüşte kart ve detay zaten kendilerini tazeliyor —
 * kalan hak hiçbir yerde yerelde güncellenmiyor, hep sunucudan geliyor.
 */
@Composable
fun SellPackageHost(
    session: AppSession,
    container: ServiceContainer,
    customerId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: SellPackageViewModel =
        viewModel(
            key = "sell-package-$customerId",
            factory = SellPackageViewModel.factory(container, customerId, session.activeBranchId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(customerId) { viewModel.load() }
    // Satış tamamlanınca karta dön; kart listeyi taze çekecek.
    LaunchedEffect(state.sold) { if (state.sold != null) onBack() }

    SellPackageSheet(
        state = state,
        branchName = session.activeBranch?.name,
        canSwitchBranch = session.canSwitchBranch,
        onSelect = viewModel::select,
        onNoteChange = viewModel::setNote,
        onSell = viewModel::sell,
        onRetry = viewModel::load,
        onDismissError = viewModel::dismissError,
        onBack = onBack,
        modifier = modifier,
    )
}

@Composable
fun CustomerPackageDetailHost(
    session: AppSession,
    container: ServiceContainer,
    packageId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: CustomerPackageDetailViewModel =
        viewModel(
            key = "customer-package-$packageId",
            factory = CustomerPackageDetailViewModel.factory(container, packageId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }

    // İşlem ekranından dönüşte de koşar: `version` ve defter taze gelsin.
    LaunchedEffect(packageId) { viewModel.load() }

    CustomerPackageDetailScreen(
        state = state,
        clock = clock,
        onBack = onBack,
        onRetry = viewModel::load,
        onLoadMoreLedger = viewModel::loadMoreLedger,
        modifier = modifier,
    )
}

@Composable
fun BindPackageHost(
    session: AppSession,
    container: ServiceContainer,
    appointmentId: String,
    appointmentServiceId: String,
    serviceName: String?,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: BindPackageViewModel =
        viewModel(
            key = "bind-package-$appointmentId-$appointmentServiceId",
            factory = BindPackageViewModel.factory(container, appointmentId, appointmentServiceId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }

    LaunchedEffect(appointmentId, appointmentServiceId) { viewModel.load() }
    LaunchedEffect(state.result) { if (state.result != null) onBack() }

    BindPackageSheet(
        state = state,
        // Randevu satırı hizmet ADINI taşımıyor; route'tan gelmediyse hakların taşıdığı ada düşülür.
        serviceName = serviceName ?: state.entitlements.valueOrNull?.firstOrNull()?.serviceName,
        clock = clock,
        onSelect = viewModel::select,
        onBind = viewModel::bind,
        onRetry = viewModel::load,
        onDismissError = viewModel::dismissError,
        onBack = onBack,
        modifier = modifier,
    )
}
