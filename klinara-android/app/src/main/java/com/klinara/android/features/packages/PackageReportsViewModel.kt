package com.klinara.android.features.packages

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.packages.ExpiringReport
import com.klinara.android.services.packages.OutstandingGrouping
import com.klinara.android.services.packages.OutstandingReport
import com.klinara.android.services.packages.PackagesService
import com.klinara.android.services.packages.UsageGrouping
import com.klinara.android.services.packages.UsageReport
import com.klinara.android.services.reports.ReportPeriod
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant

data class PackageReportsUiState(
    /** Dönem başlangıcı — DAİMA ayın ilk anı, şube saatinde. */
    val periodStart: Instant,
    /** Yarı açık üst sınır: ertesi ayın ilk anı, HARİÇ. */
    val periodEnd: Instant,
    val outstanding: Loadable<OutstandingReport> = Loadable.Loading,
    val expiring: Loadable<ExpiringReport> = Loadable.Loading,
    val usage: Loadable<UsageReport> = Loadable.Loading,
    val outstandingGrouping: OutstandingGrouping = OutstandingGrouping.Service,
    val usageGrouping: UsageGrouping = UsageGrouping.Service,
    val isLoadingMoreExpiring: Boolean = false,
) {
    val period: ReportPeriod get() = ReportPeriod(periodStart, periodEnd)

    /** İmleç yanıtın İÇİNDE taşınıyor — sayfa ile imleç ayrı yerlerde durmasın. */
    val canLoadMoreExpiring: Boolean
        get() = expiring.valueOrNull?.pageInfo?.nextCursor != null && !isLoadingMoreExpiring
}

/**
 * Paket raporları (A5.4) — üç rapor TEK durumda: şube ve dönem ortak ve kullanıcı bir
 * rapordan diğerine geçerken aralığı yeniden seçmek zorunda kalmamalı.
 *
 * ViewModel rapor girişi hedefinin geri yığını kaydına bağlı; üç rapor ekranı onu
 * paylaşıyor. Oturum boyunca bellekte tutulacak bir şey değil — Yönetim'den çıkınca ölür.
 *
 * **Dönem yarı açık `[ayBaşı, ertesiAyBaşı)`.** "30 Eylül'e kadar" diye `to = 30 Eylül
 * 00:00` göndermek ayın son gününü sessizce dışarıda bırakırdı.
 */
class PackageReportsViewModel(
    private val service: PackagesService,
    private val clock: BranchClock,
    private val branchId: String?,
    now: Instant = Instant.now(),
) : ViewModel() {
    private val _state =
        MutableStateFlow(
            clock.startOfMonth(now).let { start ->
                PackageReportsUiState(periodStart = start, periodEnd = clock.addingMonths(1, start))
            },
        )
    val state: StateFlow<PackageReportsUiState> = _state.asStateFlow()

    private var expiringJob: Job? = null

    /** Kullanıcıya gösterilen aralık: üst sınır hariç olduğu için BİR GÜN ÖNCESİ yazılır. */
    fun periodLabel(state: PackageReportsUiState): String =
        "${clock.formatDate(state.periodStart)} – ${clock.formatDate(clock.adding(-1, state.periodEnd))}"

    fun shiftPeriod(months: Long) {
        _state.update {
            val start = clock.addingMonths(months, it.periodStart)
            it.copy(periodStart = start, periodEnd = clock.addingMonths(1, start))
        }
    }

    fun loadOutstanding() {
        val grouping = _state.value.outstandingGrouping
        _state.update { it.copy(outstanding = Loadable.Loading) }
        viewModelScope.launch {
            _state.update { it.copy(outstanding = Loadable.of { service.outstandingReport(branchId, grouping) }) }
        }
    }

    fun setOutstandingGrouping(grouping: OutstandingGrouping) {
        _state.update { it.copy(outstandingGrouping = grouping) }
        loadOutstanding()
    }

    fun loadExpiring() {
        expiringJob?.cancel()
        val period = _state.value.period
        _state.update { it.copy(expiring = Loadable.Loading, isLoadingMoreExpiring = false) }
        expiringJob =
            viewModelScope.launch {
                _state.update { it.copy(expiring = Loadable.of { service.expiringReport(period, branchId) }) }
            }
    }

    /**
     * Sonraki sayfa. Sayfa hatası elde olan satırları DÜŞÜRMEZ: yarım bir liste hiç liste
     * olmamasından iyidir. Dönem değişirse (iş iptal edilir) eski dönemin sayfası yeni
     * listeye eklenmez.
     */
    fun loadMoreExpiring() {
        val current = _state.value
        if (!current.canLoadMoreExpiring) return
        val report = current.expiring.valueOrNull ?: return
        val cursor = report.pageInfo.nextCursor ?: return
        _state.update { it.copy(isLoadingMoreExpiring = true) }
        expiringJob =
            viewModelScope.launch {
                when (val page = Loadable.of { service.expiringReport(current.period, branchId, cursor = cursor) }) {
                    is Loadable.Loaded ->
                        _state.update {
                            it.copy(
                                expiring =
                                    Loadable.Loaded(ExpiringReport(report.data + page.value.data, page.value.pageInfo)),
                                isLoadingMoreExpiring = false,
                            )
                        }
                    else -> _state.update { it.copy(isLoadingMoreExpiring = false) }
                }
            }
    }

    fun loadUsage() {
        val current = _state.value
        _state.update { it.copy(usage = Loadable.Loading) }
        viewModelScope.launch {
            _state.update {
                it.copy(usage = Loadable.of { service.usageReport(current.period, branchId, current.usageGrouping) })
            }
        }
    }

    fun setUsageGrouping(grouping: UsageGrouping) {
        _state.update { it.copy(usageGrouping = grouping) }
        loadUsage()
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            clock: BranchClock,
            branchId: String?,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    PackageReportsViewModel(container.packages, clock, branchId) as T
            }
    }
}
