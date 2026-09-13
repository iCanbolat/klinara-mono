package com.klinara.android.features.reports

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.reports.NoShowGrouping
import com.klinara.android.services.reports.NoShowReport
import com.klinara.android.services.reports.OccupancyGrouping
import com.klinara.android.services.reports.OccupancyReport
import com.klinara.android.services.reports.ReportKind
import com.klinara.android.services.reports.ReportPage
import com.klinara.android.services.reports.ReportPeriod
import com.klinara.android.services.reports.ReportQuery
import com.klinara.android.services.reports.ReportsService
import com.klinara.android.services.reports.RetentionReport
import com.klinara.android.services.reports.RevenueGrouping
import com.klinara.android.services.reports.RevenueReport
import com.klinara.android.services.reports.StaffPerformanceReport
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant

data class ReportsUiState(
    /** Dönem başlangıcı — DAİMA ayın ilk anı, şube saatinde. */
    val periodStart: Instant,
    /** Yarı açık üst sınır: ertesi ayın ilk anı, HARİÇ. */
    val periodEnd: Instant,
    val compareToPrevious: Boolean = false,
    val occupancyGrouping: OccupancyGrouping = OccupancyGrouping.Staff,
    val revenueGrouping: RevenueGrouping = RevenueGrouping.Service,
    val noShowGrouping: NoShowGrouping = NoShowGrouping.Staff,
    val occupancy: Loadable<OccupancyReport> = Loadable.Loading,
    val revenue: Loadable<RevenueReport> = Loadable.Loading,
    val staffPerformance: Loadable<StaffPerformanceReport> = Loadable.Loading,
    val noShow: Loadable<NoShowReport> = Loadable.Loading,
    val retention: Loadable<RetentionReport> = Loadable.Loading,
    /** Sonraki sayfası yolda olan raporlar — ikinci bir sayfa isteği başlatılmaz. */
    val loadingMore: Set<ReportKind> = emptySet(),
    val export: ExportState = ExportState(),
) {
    val period: ReportPeriod get() = ReportPeriod(periodStart, periodEnd)

    /**
     * Sunucunun karşılaştırdığı pencere: hemen önceki, AYNI UZUNLUKTA aralık — "önceki ay"
     * DEĞİL (30 günlük eylül, 2 Ağustos'tan başlayan 30 günle kıyaslanır). Ekran bunu yazar ki
     * kullanıcı "ağustosla kıyasladım" sanmasın. Hesap yalnız GÖSTERİM için; sayı sunucudan.
     */
    val previousPeriod: ReportPeriod
        get() = ReportPeriod(periodStart.minus(Duration.between(periodStart, periodEnd)), periodStart)

    /** İmleç yanıtın İÇİNDE taşınıyor — sayfa ile imleç ayrı yerlerde durmasın. */
    fun nextCursor(kind: ReportKind): String? =
        when (kind) {
            ReportKind.Occupancy -> occupancy.valueOrNull?.pageInfo?.nextCursor
            ReportKind.Revenue -> revenue.valueOrNull?.pageInfo?.nextCursor
            ReportKind.StaffPerformance -> staffPerformance.valueOrNull?.pageInfo?.nextCursor
            ReportKind.NoShow -> noShow.valueOrNull?.pageInfo?.nextCursor
            // Kazanımın kırılım LİSTESİ yok: sayfalamak olmayan bir listeye sayfa vermek olurdu.
            ReportKind.Retention -> null
        }

    fun canLoadMore(kind: ReportKind): Boolean = nextCursor(kind) != null && kind !in loadingMore
}

/**
 * CSV dışa aktarımın durumu.
 *
 * Baytlar **yalnız bellekte** durur: uygulama kendi dizinine sağlık/ciro verisi yazmaz, dosya
 * SAF ile kullanıcının seçtiği konuma yazılır (§7.9 — "sağlık verisi diskte artakalmıyor").
 * Kaydedildikten sonra [file] hemen bırakılır.
 */
data class ExportState(
    val preparing: ReportKind? = null,
    val file: ReportFile? = null,
    val savedName: String? = null,
    val error: String? = null,
)

/** Kullanıcının seçeceği konuma yazılacak dosya; [bytes] sunucunun ürettiği CSV. */
class ReportFile(
    val name: String,
    val bytes: ByteArray,
)

/**
 * Klinik raporları (A9) — iOS `ReportsStore` paritesi. Beş rapor TEK durumda: dönem ve
 * karşılaştırma ortak, kullanıcı raporlar arasında geçerken aralığı yeniden seçmez.
 *
 * ViewModel rapor girişinin geri yığını kaydına bağlı; Yönetim'den çıkınca ölür. Şube
 * değişimi ViewModel anahtarını değiştirir (yeni şube = yeni durum).
 *
 * **Girdiyi değiştiren metotlar yükleme BAŞLATMAZ**; ekran yüklemeyi kendi girdilerine
 * anahtarlanmış bir efektle ister. Böylece yalnız açık olan rapor sunucuya gider — beş raporu
 * her dönem kaydırmasında çekmek dört boşa istek olurdu.
 *
 * **Sayfa ekleme toplamları DEĞİŞTİRMEZ**: sunucu `totals`/`previous`/`delta`'yı aralığın
 * tamamından hesaplar; ilk sayfanınkiler geçerli kalır, yalnız satırlar eklenir.
 */
class ReportsViewModel(
    private val service: ReportsService,
    private val clock: BranchClock,
    private val branchId: String?,
    now: Instant = Instant.now(),
) : ViewModel() {
    private val _state =
        MutableStateFlow(
            clock.startOfMonth(now).let { start ->
                ReportsUiState(periodStart = start, periodEnd = clock.addingMonths(1, start))
            },
        )
    val state: StateFlow<ReportsUiState> = _state.asStateFlow()

    private val jobs = mutableMapOf<ReportKind, Job>()

    /** Üst sınır hariç olduğu için kullanıcıya BİR GÜN ÖNCESİ yazılır. */
    fun label(period: ReportPeriod): String =
        "${clock.formatDate(period.from)} – ${clock.formatDate(clock.adding(-1, period.to))}"

    fun shiftPeriod(months: Long) {
        _state.update {
            val start = clock.addingMonths(months, it.periodStart)
            it.copy(periodStart = start, periodEnd = clock.addingMonths(1, start))
        }
    }

    fun setCompareToPrevious(enabled: Boolean) = _state.update { it.copy(compareToPrevious = enabled) }

    fun setOccupancyGrouping(grouping: OccupancyGrouping) = _state.update { it.copy(occupancyGrouping = grouping) }

    fun setRevenueGrouping(grouping: RevenueGrouping) = _state.update { it.copy(revenueGrouping = grouping) }

    fun setNoShowGrouping(grouping: NoShowGrouping) = _state.update { it.copy(noShowGrouping = grouping) }

    /** İlk sayfa. Aynı raporun yolda olan isteği (ilk ya da sonraki sayfa) iptal edilir. */
    fun load(kind: ReportKind) {
        val current = _state.value
        val query = query(current)
        val first = ReportPage(limit = PAGE_SIZE)
        when (kind) {
            ReportKind.Occupancy ->
                launch(kind, { s, v -> s.copy(occupancy = v) }) {
                    service.occupancy(query, current.occupancyGrouping, first)
                }
            ReportKind.Revenue ->
                launch(kind, { s, v -> s.copy(revenue = v) }) {
                    service.revenue(query, current.revenueGrouping, first)
                }
            ReportKind.StaffPerformance ->
                launch(kind, { s, v -> s.copy(staffPerformance = v) }) { service.staffPerformance(query, first) }
            ReportKind.NoShow ->
                launch(kind, { s, v -> s.copy(noShow = v) }) {
                    service.noShow(query, current.noShowGrouping, first)
                }
            ReportKind.Retention -> launch(kind, { s, v -> s.copy(retention = v) }) { service.retention(query) }
        }
    }

    /**
     * Sonraki sayfa. Sayfa hatası eldeki satırları DÜŞÜRMEZ — yarım bir rapor, hiç rapor
     * olmamasından iyidir; düğme yerinde kalır, kullanıcı yeniden dener. Dönem ya da gruplama
     * değişirse [load] bu işi iptal eder: eski dönemin sayfası yeni rapora eklenmez.
     */
    fun loadMore(kind: ReportKind) {
        val current = _state.value
        if (!current.canLoadMore(kind)) return
        val page = ReportPage(limit = PAGE_SIZE, cursor = current.nextCursor(kind))
        val query = query(current)
        _state.update { it.copy(loadingMore = it.loadingMore + kind) }
        jobs[kind] =
            viewModelScope.launch {
                val merge = Loadable.of { nextPage(kind, query, current, page) }
                _state.update { state ->
                    val merged = (merge as? Loadable.Loaded)?.value?.invoke(state) ?: state
                    merged.copy(loadingMore = merged.loadingMore - kind)
                }
            }
    }

    /** Sonraki sayfayı çeker ve onu eldeki rapora ekleyen dönüşümü döndürür. */
    private suspend fun nextPage(
        kind: ReportKind,
        query: ReportQuery,
        state: ReportsUiState,
        page: ReportPage,
    ): (ReportsUiState) -> ReportsUiState =
        when (kind) {
            ReportKind.Occupancy ->
                service.occupancy(query, state.occupancyGrouping, page).let { more ->
                    { s -> s.copy(occupancy = s.occupancy.append { it + more }) }
                }
            ReportKind.Revenue ->
                service.revenue(query, state.revenueGrouping, page).let { more ->
                    { s -> s.copy(revenue = s.revenue.append { it + more }) }
                }
            ReportKind.StaffPerformance ->
                service.staffPerformance(query, page).let { more ->
                    { s ->
                        s.copy(
                            staffPerformance =
                                s.staffPerformance.append { it + more },
                        )
                    }
                }
            ReportKind.NoShow ->
                service.noShow(query, state.noShowGrouping, page).let { more ->
                    { s -> s.copy(noShow = s.noShow.append { it + more }) }
                }
            ReportKind.Retention -> { s -> s }
        }

    /**
     * CSV'yi hazırlar. Dışa aktarım SAYFALANMAZ ve karşılaştırma taşımaz (sunucu ikisini de
     * gövdeden siliyor); dosya adı sunucunun `csvFilename`'iyle aynı şemada, ama günler ŞUBE
     * saatinde: sunucu UTC `Z` gönderen istemcide günü bir gün geriye yazardı.
     */
    fun export(kind: ReportKind) {
        val current = _state.value
        if (current.export.preparing != null) return
        _state.update { it.copy(export = ExportState(preparing = kind)) }
        val query = ReportQuery(current.period, branchId, compareToPrevious = false)
        val groupBy =
            when (kind) {
                ReportKind.Occupancy -> current.occupancyGrouping.wire
                ReportKind.Revenue -> current.revenueGrouping.wire
                ReportKind.NoShow -> current.noShowGrouping.wire
                ReportKind.StaffPerformance, ReportKind.Retention -> null
            }
        viewModelScope.launch {
            val result = Loadable.of { service.export(kind, query, groupBy) }
            _state.update {
                when (result) {
                    is Loadable.Loaded -> it.copy(export = ExportState(file = ReportFile(fileName(kind), result.value)))
                    is Loadable.Failed -> it.copy(export = ExportState(error = result.message))
                    Loadable.Loading -> it.copy(export = ExportState())
                }
            }
        }
    }

    /** `doluluk-2026-09-01-2026-10-01.csv` — sunucunun adıyla aynı; üst sınır HARİÇ gündür. */
    fun fileName(kind: ReportKind): String {
        val state = _state.value
        val from = clock.localDateString(state.periodStart)
        val to = clock.localDateString(state.periodEnd)
        return "${kind.filePrefix}-$from-$to.csv"
    }

    /**
     * Hazır dosyayı kullanıcının seçtiği konuma yazar. [sink] bir `OutputStream`e yazan çağıran;
     * `ContentResolver` ViewModel'e girmiyor. Baytlar yazıldıktan sonra durumdan DÜŞÜRÜLÜR.
     */
    fun save(sink: suspend (ByteArray) -> Unit) {
        val file = _state.value.export.file ?: return
        viewModelScope.launch {
            val written = runCatching { sink(file.bytes) }
            _state.update {
                it.copy(
                    export =
                        if (written.isSuccess) {
                            ExportState(savedName = file.name)
                        } else {
                            ExportState(error = "Dosya kaydedilemedi. Başka bir konum deneyin.")
                        },
                )
            }
        }
    }

    /** Kullanıcı dosya seçiciyi kapattı ya da mesajı okudu: baytlar bellekte tutulmaz. */
    fun clearExport() = _state.update { it.copy(export = ExportState()) }

    private fun query(state: ReportsUiState) = ReportQuery(state.period, branchId, state.compareToPrevious)

    private fun <R> launch(
        kind: ReportKind,
        apply: (ReportsUiState, Loadable<R>) -> ReportsUiState,
        fetch: suspend () -> R,
    ) {
        jobs[kind]?.cancel()
        _state.update { apply(it, Loadable.Loading).copy(loadingMore = it.loadingMore - kind) }
        jobs[kind] =
            viewModelScope.launch {
                val result = Loadable.of { fetch() }
                _state.update { apply(it, result) }
            }
    }

    companion object {
        /**
         * Kırılım satırlarının sayfa boyutu. Sayfalama olmadan `groupBy=day` ile uzun bir
         * dönem yüzlerce satırı tek yanıtta telefona indirirdi; sunucuda opt-in, mobil açıyor.
         */
        const val PAGE_SIZE = 50

        fun factory(
            container: ServiceContainer,
            clock: BranchClock,
            branchId: String?,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    ReportsViewModel(container.reports, clock, branchId) as T
            }
    }
}

// Sayfa ekleme: satırlar birleşir, imleç yenisinden; toplamlar İLK sayfadaki kalır.
private operator fun OccupancyReport.plus(more: OccupancyReport) =
    copy(data = data + more.data, pageInfo = more.pageInfo)

private operator fun RevenueReport.plus(more: RevenueReport) = copy(data = data + more.data, pageInfo = more.pageInfo)

private operator fun StaffPerformanceReport.plus(more: StaffPerformanceReport) =
    copy(data = data + more.data, pageInfo = more.pageInfo)

private operator fun NoShowReport.plus(more: NoShowReport) = copy(data = data + more.data, pageInfo = more.pageInfo)

/** Yüklüyse dönüştür; değilse (sayfa beklerken rapor yeniden yüklendiyse) dokunma. */
private inline fun <T> Loadable<T>.append(transform: (T) -> T): Loadable<T> =
    if (this is Loadable.Loaded) Loadable.Loaded(transform(value)) else this
