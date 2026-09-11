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
import com.klinara.android.services.contracts.Permissions
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
    onOperation: (PackageOperation) -> Unit,
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
        actions = { pkg ->
            PackageActionsCard(
                pkg = pkg,
                permissions = session.packagePermissions,
                now = java.time.Instant.now(),
                onOperation = onOperation,
            )
        },
    )
}

/**
 * Düzeltme / iade / devir hedefi. İşlemin izni burada BİR KEZ DAHA kontrol edilir: hedef
 * derin bağlantıyla da açılabilir ve düğmeyi gizlemek tek başına bir kapı değildir.
 */
@Composable
fun PackageOperationHost(
    session: AppSession,
    container: ServiceContainer,
    packageId: String,
    operation: PackageOperation,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val permissions = session.packagePermissions
    val allowed =
        when (operation) {
            PackageOperation.Adjust -> permissions.canWrite
            PackageOperation.Refund -> permissions.canRefund
            PackageOperation.Transfer -> permissions.canTransfer
        }
    if (!allowed) {
        LaunchedEffect(Unit) { onBack() }
        return
    }

    val viewModel: PackageOperationViewModel =
        viewModel(
            key = "package-${operation.wire}-$packageId",
            factory = PackageOperationViewModel.factory(container, packageId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(packageId) { viewModel.load() }
    // Başarıda detaya dön; detay `version`'ı ve defteri taze çekecek.
    LaunchedEffect(state.isDone) { if (state.isDone) onBack() }

    val submit = { viewModel.submit(operation) }
    when (operation) {
        PackageOperation.Adjust ->
            PackageAdjustSheet(
                state = state,
                onAmountChange = viewModel::setAmount,
                onReasonChange = viewModel::setReason,
                onSubmit = submit,
                onRetry = viewModel::load,
                onDismissError = viewModel::dismissError,
                onBack = onBack,
                modifier = modifier,
            )
        PackageOperation.Refund ->
            PackageRefundSheet(
                state = state,
                onWholeChange = viewModel::setWhole,
                onAmountChange = viewModel::setAmount,
                onReasonChange = viewModel::setReason,
                onSubmit = submit,
                onRetry = viewModel::load,
                onDismissError = viewModel::dismissError,
                onBack = onBack,
                modifier = modifier,
            )
        PackageOperation.Transfer ->
            PackageTransferSheet(
                state = state,
                onQueryChange = viewModel::searchCustomers,
                onSelectTarget = viewModel::selectTarget,
                onWholeChange = viewModel::setWhole,
                onAmountChange = viewModel::setAmount,
                onReasonChange = viewModel::setReason,
                onSubmit = submit,
                onRetry = viewModel::load,
                onDismissError = viewModel::dismissError,
                onBack = onBack,
                modifier = modifier,
            )
    }
}

/** Üç paket izni tek yerde — ekranlar tek tek `session.can` yazıp birini unutmasın. */
val AppSession.packagePermissions: PackagePermissions
    get() =
        PackagePermissions(
            canWrite = can(Permissions.PACKAGE_WRITE),
            canRefund = can(Permissions.PACKAGE_REFUND),
            canTransfer = can(Permissions.PACKAGE_TRANSFER),
        )

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


/** Paket raporlarının dört hedefi. */
enum class PackageReportScreen { Home, Outstanding, Expiring, Usage }

/**
 * Rapor hedefleri TEK ViewModel'i paylaşır — [owner] rapor girişinin geri yığını kaydı.
 * Şube ve dönem bir rapordan diğerine taşınır; Yönetim'den çıkınca ViewModel de ölür.
 */
@Composable
fun PackageReportsHost(
    session: AppSession,
    container: ServiceContainer,
    screen: PackageReportScreen,
    owner: androidx.lifecycle.ViewModelStoreOwner,
    onOpen: (PackageReportScreen) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }
    val viewModel: PackageReportsViewModel =
        viewModel(
            viewModelStoreOwner = owner,
            key = "package-reports-${session.activeBranchId}",
            factory = PackageReportsViewModel.factory(container, clock, session.activeBranchId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val canReadRevenue = session.can(Permissions.REPORT_REVENUE_READ)

    when (screen) {
        PackageReportScreen.Home ->
            PackageReportsHomeScreen(
                canReadRevenue = canReadRevenue,
                onOpenOutstanding = { onOpen(PackageReportScreen.Outstanding) },
                onOpenExpiring = { onOpen(PackageReportScreen.Expiring) },
                onOpenUsage = { onOpen(PackageReportScreen.Usage) },
                onBack = onBack,
                modifier = modifier,
            )
        PackageReportScreen.Outstanding -> {
            // Derin bağlantıyla gelinse bile izinsiz rol sunucuya 403 için gitmez.
            if (!canReadRevenue) {
                LaunchedEffect(Unit) { onBack() }
                return
            }
            LaunchedEffect(Unit) { viewModel.loadOutstanding() }
            OutstandingReportScreen(
                state = state,
                onGroupingChange = viewModel::setOutstandingGrouping,
                onRetry = viewModel::loadOutstanding,
                onBack = onBack,
                modifier = modifier,
            )
        }
        PackageReportScreen.Expiring -> {
            LaunchedEffect(state.periodStart) { viewModel.loadExpiring() }
            ExpiringReportScreen(
                state = state,
                periodLabel = viewModel.periodLabel(state),
                clock = clock,
                onShift = viewModel::shiftPeriod,
                onLoadMore = viewModel::loadMoreExpiring,
                onRetry = viewModel::loadExpiring,
                onBack = onBack,
                modifier = modifier,
            )
        }
        PackageReportScreen.Usage -> {
            LaunchedEffect(state.periodStart) { viewModel.loadUsage() }
            UsageReportScreen(
                state = state,
                periodLabel = viewModel.periodLabel(state),
                onShift = viewModel::shiftPeriod,
                onGroupingChange = viewModel::setUsageGrouping,
                onRetry = viewModel::loadUsage,
                onBack = onBack,
                modifier = modifier,
            )
        }
    }
}
