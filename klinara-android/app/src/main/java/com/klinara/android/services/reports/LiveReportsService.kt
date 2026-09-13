package com.klinara.android.services.reports

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class LiveReportsService(
    private val client: ApiClient,
) : ReportsService {
    override suspend fun occupancy(
        query: ReportQuery,
        groupBy: OccupancyGrouping,
        page: ReportPage,
    ): OccupancyReport =
        client.send(ApiRequest.get("reports/occupancy", query.wire(page) + ("groupBy" to groupBy.wire)))

    override suspend fun revenue(
        query: ReportQuery,
        groupBy: RevenueGrouping,
        page: ReportPage,
    ): RevenueReport = client.send(ApiRequest.get("reports/revenue", query.wire(page) + ("groupBy" to groupBy.wire)))

    override suspend fun staffPerformance(
        query: ReportQuery,
        page: ReportPage,
    ): StaffPerformanceReport =
        client.send(ApiRequest.get("reports/staff-performance", query.copy(compareToPrevious = false).wire(page)))

    override suspend fun noShow(
        query: ReportQuery,
        groupBy: NoShowGrouping,
        page: ReportPage,
    ): NoShowReport = client.send(ApiRequest.get("reports/no-show", query.wire(page) + ("groupBy" to groupBy.wire)))

    override suspend fun retention(query: ReportQuery): RetentionReport =
        client.send(ApiRequest.get("reports/retention", query.wire(ReportPage.UNPAGED)))

    override suspend fun export(
        kind: ReportKind,
        query: ReportQuery,
        groupBy: String?,
    ): ByteArray =
        client.sendBytes(
            ApiRequest.post("reports/${kind.path}/export", body = query.exportBody(groupBy).asBody()),
        )
}

/**
 * Ortak sorgu. `compareTo` yalnız istendiğinde eklenir (sunucu varsayılanı `none`); `limit`
 * YOKSA sunucu tüm satırları döndürür.
 */
internal fun ReportQuery.wire(page: ReportPage): List<Pair<String, String>> =
    period.wire() +
        listOfNotNull(
            branchId?.let { "branchId" to it },
            ("compareTo" to "previous").takeIf { compareToPrevious },
            page.limit?.let { "limit" to it.toString() },
            page.cursor?.let { "cursor" to it },
        )

/**
 * Dışa aktarım gövdesi. `limit`/`cursor` ve `compareTo` YOK: sunucu ilk ikisini zaten
 * siliyor, CSV de karşılaştırma taşımıyor. `null` alan yazılmaz (`whitelist` pipe'ı).
 */
internal fun ReportQuery.exportBody(groupBy: String?): JsonObject =
    buildJsonObject {
        period.wire().forEach { (name, value) -> put(name, value) }
        branchId?.let { put("branchId", it) }
        groupBy?.let { put("groupBy", it) }
    }

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
