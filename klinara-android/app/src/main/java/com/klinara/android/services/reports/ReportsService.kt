package com.klinara.android.services.reports

/**
 * Klinik raporları (Faz A9) — iOS `ReportsService` paritesi; sunucu `ReportsController` +
 * `ReportExportController`.
 *
 * Paket raporları (A5.4) `PackagesService`'te kalıyor: sunucuda ayrı bir controller ve ayrı
 * bir izin (`package:read`) altındalar. Buraya taşımak izin sınırını istemcide bulanıklaştırırdı.
 *
 * **Sayfalama opt-in** ([ReportPage.limit] yoksa sunucu tüm satırları döndürür). `totals`,
 * `previous` ve `delta` sayfadan ETKİLENMEZ — aralığın tamamından hesaplanır.
 */
interface ReportsService {
    /** `GET reports/occupancy` — `appointment:read.all` YA DA `report.performance:read.own`. */
    suspend fun occupancy(
        query: ReportQuery,
        groupBy: OccupancyGrouping,
        page: ReportPage = ReportPage.UNPAGED,
    ): OccupancyReport

    /** `GET reports/revenue` — `report.revenue:read`. */
    suspend fun revenue(
        query: ReportQuery,
        groupBy: RevenueGrouping,
        page: ReportPage = ReportPage.UNPAGED,
    ): RevenueReport

    /**
     * `GET reports/staff-performance` — `report.revenue:read` YA DA `report.performance:read.own`.
     * Yalnız ikincisini taşıyan çağıran KENDİ satırına kilitlenir ve yanıt `scope: own` döner.
     * `compareTo` bu uçta yok sayıldığı için hiç gönderilmez.
     */
    suspend fun staffPerformance(
        query: ReportQuery,
        page: ReportPage = ReportPage.UNPAGED,
    ): StaffPerformanceReport

    /** `GET reports/no-show` — `appointment:read.all`. */
    suspend fun noShow(
        query: ReportQuery,
        groupBy: NoShowGrouping,
        page: ReportPage = ReportPage.UNPAGED,
    ): NoShowReport

    /** `GET reports/retention` — `appointment:read.all`. Sayfasız: kırılım listesi yok. */
    suspend fun retention(query: ReportQuery): RetentionReport

    /**
     * `POST reports/{kind}/export` — ham CSV baytları (UTF-8 BOM, `;` ayraç, Excel için).
     *
     * `POST` ama hiçbir şey YAZMIYOR: filtre gövdede taşınıyor ki tarih aralığı ve şube erişim
     * loglarına düşmesin. Dışa aktarım SAYFALANMAZ; sunucu 50 bin satırı aşan isteği
     * `VALIDATION_FAILED` ile reddeder ("aralığı daraltın").
     *
     * [groupBy] raporun kendi gruplamasının `wire` değeri; staff-performance ve retention'da `null`.
     */
    suspend fun export(
        kind: ReportKind,
        query: ReportQuery,
        groupBy: String? = null,
    ): ByteArray
}
