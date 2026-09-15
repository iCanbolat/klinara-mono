package com.klinara.android.features.reports

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.RowScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.reports.ReportKind
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Klinik raporlarının gezinme kabuğu. [kind] `null` → giriş ekranı.
 *
 * Giriş ve beş rapor, giriş hedefinin geri yığını kaydına bağlı TEK ViewModel'i paylaşır
 * ([owner]): dönem ve karşılaştırma raporlar arasında taşınır. Şube değişince anahtar değişir,
 * yeni şube yeni durumla başlar.
 *
 * Yükleme efekti raporun GİRDİLERİNE anahtarlı (dönem, karşılaştırma, gruplama): girdi
 * değişince yalnız açık rapor yeniden çekilir.
 */
@Composable
@Suppress("LongParameterList")
fun ReportsHost(
    session: AppSession,
    container: ServiceContainer,
    kind: ReportKind?,
    owner: ViewModelStoreOwner,
    onOpen: (ReportKind) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null,
    /**
     * Rapor şubesi. Yönetim'den seçili şube; Dashboard'dan `null` — kartı "erişebildiğim tüm
     * şubeler" üzerinden hesaplandı, "Tümünü gör" aynı kapsamı açmalı ki sayılar tutsun.
     */
    branchId: String? = session.activeBranchId,
) {
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }
    val viewModel: ReportsViewModel =
        viewModel(
            viewModelStoreOwner = owner,
            key = "reports-$branchId",
            factory = ReportsViewModel.factory(container, clock, branchId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()

    if (kind == null) {
        ReportsHomeScreen(
            visible = ReportAccess.visible(session::can),
            onOpen = onOpen,
            onBack = onBack,
            modifier = modifier,
            trailing = trailing,
        )
        return
    }

    // Derin bağlantıyla gelinse bile izinsiz rol sunucuya 403 için gitmez.
    if (!ReportAccess.canOpen(kind, session::can)) {
        LaunchedEffect(Unit) { onBack() }
        return
    }

    LaunchedEffect(kind, state.periodStart, compareInput(state, kind), groupingInput(state, kind)) {
        viewModel.load(kind)
    }
    SaveAsCsv(viewModel, state.export.file)

    val labels = ReportLabels(period = viewModel.label(state.period), previous = viewModel.label(state.previousPeriod))
    val actions =
        ReportActions(
            onShift = viewModel::shiftPeriod,
            onCompareChange = viewModel::setCompareToPrevious,
            onRetry = { viewModel.load(kind) },
            onLoadMore = { viewModel.loadMore(kind) },
            onExport = { viewModel.export(kind) },
            onDismissExport = viewModel::clearExport,
            onBack = onBack,
        )
    when (kind) {
        ReportKind.Occupancy ->
            OccupancyReportScreen(state, labels, actions, viewModel::setOccupancyGrouping, modifier)
        ReportKind.Revenue -> RevenueReportScreen(state, labels, actions, viewModel::setRevenueGrouping, modifier)
        ReportKind.StaffPerformance -> StaffPerformanceReportScreen(state, labels, actions, modifier)
        ReportKind.NoShow -> NoShowReportScreen(state, labels, actions, viewModel::setNoShowGrouping, modifier)
        ReportKind.Retention -> RetentionReportScreen(state, labels, actions, modifier)
    }
}

/**
 * Hazır CSV'yi SAF ile **kullanıcının seçtiği konuma** yazar; uygulama kendi dizinine sağlık ya da
 * ciro verisi yazmaz. Seçici kapatılırsa (uri `null`) baytlar durumdan hemen düşürülür.
 */
@Composable
private fun SaveAsCsv(
    viewModel: ReportsViewModel,
    pending: ReportFile?,
) {
    val resolver = LocalContext.current.contentResolver
    val saveAs =
        rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(CSV_MIME)) { uri ->
            if (uri == null) {
                viewModel.clearExport()
            } else {
                viewModel.save { bytes ->
                    withContext(Dispatchers.IO) {
                        requireNotNull(resolver.openOutputStream(uri)).use { it.write(bytes) }
                    }
                }
            }
        }
    LaunchedEffect(pending) { pending?.let { saveAs.launch(it.name) } }
}

/** Raporun gruplaması — değişince yeniden yüklenir. Gruplaması olmayan raporda `null`. */
private fun groupingInput(
    state: ReportsUiState,
    kind: ReportKind,
): Any? =
    when (kind) {
        ReportKind.Occupancy -> state.occupancyGrouping
        ReportKind.Revenue -> state.revenueGrouping
        ReportKind.NoShow -> state.noShowGrouping
        ReportKind.StaffPerformance, ReportKind.Retention -> null
    }

/** Personel performansında `compareTo` gönderilmiyor: anahtarın değişmesi yeniden yükleme İSTEMEZ. */
private fun compareInput(
    state: ReportsUiState,
    kind: ReportKind,
): Boolean? = state.compareToPrevious.takeIf { kind != ReportKind.StaffPerformance }

/** `text/csv` — sunucunun `Content-Type`'ı; seçici dosya adına `.csv` uzantısını buna göre koyar. */
private const val CSV_MIME = "text/csv"
