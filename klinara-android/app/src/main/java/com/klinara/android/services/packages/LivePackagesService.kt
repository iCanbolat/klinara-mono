package com.klinara.android.services.packages

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject
import java.time.format.DateTimeFormatter

class LivePackagesService internal constructor(
    private val client: ApiClient,
) : PackagesService {
    // --- Tanımlar ---

    override suspend fun definitions(query: PackageDefinitionQuery): Page<PackageDefinition> =
        client.send(
            ApiRequest.get(
                "package-definitions",
                query =
                    buildList {
                        query.cursor?.let { add("cursor" to it) }
                        query.limit?.let { add("limit" to it.toString()) }
                        query.branchId?.let { add("branchId" to it) }
                        query.serviceId?.let { add("serviceId" to it) }
                        // Sorgu dizesinde boolean yok, metin var: sunucu "true"/"false" bekliyor.
                        query.isActive?.let { add("isActive" to it.toString()) }
                    },
            ),
        )

    override suspend fun definition(id: String): PackageDefinition =
        client.send(ApiRequest.get("package-definitions/$id"))

    override suspend fun createDefinition(input: CreatePackageDefinitionInput): PackageDefinition =
        client.send(ApiRequest.post("package-definitions", body = input.toJson().asBody()))

    override suspend fun updateDefinition(
        id: String,
        version: Int,
        input: UpdatePackageDefinitionInput,
    ): PackageDefinition =
        client.send(
            ApiRequest.patch(
                "package-definitions/$id",
                body = input.toJson().asBody(),
                ifMatch = ApiRequest.weakETag(version),
            ),
        )

    override suspend fun retireDefinition(
        id: String,
        version: Int,
    ) = client.sendVoid(ApiRequest.delete("package-definitions/$id", ifMatch = ApiRequest.weakETag(version)))

    // --- Satış ve defter ---

    override suspend fun sell(
        input: CreateCustomerPackageInput,
        idempotencyKey: String,
    ): CustomerPackage =
        client.send(
            ApiRequest.post("customer-packages", body = input.toJson().asBody(), idempotencyKey = idempotencyKey),
        )

    override suspend fun packages(
        customerId: String,
        query: CustomerPackageQuery,
    ): Page<CustomerPackage> =
        client.send(
            ApiRequest.get(
                "customers/$customerId/packages",
                query =
                    buildList {
                        query.cursor?.let { add("cursor" to it) }
                        query.limit?.let { add("limit" to it.toString()) }
                        query.status?.let { add("status" to it.wire) }
                    },
            ),
        )

    override suspend fun customerPackage(id: String): CustomerPackage =
        client.send(ApiRequest.get("customer-packages/$id"))

    override suspend fun ledger(
        packageId: String,
        cursor: String?,
        limit: Int?,
    ): Page<PackageLedgerEntry> =
        client.send(
            ApiRequest.get(
                "customer-packages/$packageId/ledger",
                query =
                    buildList {
                        cursor?.let { add("cursor" to it) }
                        limit?.let { add("limit" to it.toString()) }
                    },
            ),
        )

    override suspend fun entitlements(
        customerId: String,
        serviceId: String?,
        branchId: String?,
    ): List<PackageEntitlement> =
        // Çıplak dizi — `ListEnvelope` DEĞİL.
        client.send(
            ApiRequest.get(
                "customers/$customerId/package-entitlements",
                query =
                    buildList {
                        serviceId?.let { add("serviceId" to it) }
                        branchId?.let { add("branchId" to it) }
                    },
            ),
        )

    override suspend fun consume(
        appointmentId: String,
        input: ConsumePackageInput,
        idempotencyKey: String,
    ): ConsumePackageResult =
        client.send(
            ApiRequest.post(
                "appointments/$appointmentId/consume-package",
                body = input.toJson().asBody(),
                idempotencyKey = idempotencyKey,
            ),
        )

    // --- Operasyonlar ---

    override suspend fun adjust(
        id: String,
        version: Int,
        input: AdjustPackageInput,
    ): CustomerPackage =
        client.send(
            ApiRequest.post(
                "customer-packages/$id/adjust",
                body = input.toJson().asBody(),
                ifMatch = ApiRequest.weakETag(version),
            ),
        )

    override suspend fun refund(
        id: String,
        version: Int,
        input: RefundPackageInput,
        idempotencyKey: String,
    ): RefundResult =
        client.send(
            ApiRequest.post(
                "customer-packages/$id/refund",
                body = input.toJson().asBody(),
                idempotencyKey = idempotencyKey,
                ifMatch = ApiRequest.weakETag(version),
            ),
        )

    override suspend fun transfer(
        id: String,
        version: Int,
        input: TransferPackageInput,
        idempotencyKey: String,
    ): CustomerPackage =
        client.send(
            ApiRequest.post(
                "customer-packages/$id/transfer",
                body = input.toJson().asBody(),
                idempotencyKey = idempotencyKey,
                ifMatch = ApiRequest.weakETag(version),
            ),
        )

    // --- Raporlar ---

    override suspend fun outstandingReport(
        branchId: String?,
        groupBy: OutstandingGrouping,
    ): OutstandingReport =
        client.send(
            ApiRequest.get(
                "reports/packages/outstanding",
                query = listOfNotNull(branchId?.let { "branchId" to it }, "groupBy" to groupBy.wire),
            ),
        )

    override suspend fun expiringReport(
        period: ReportPeriod,
        branchId: String?,
        cursor: String?,
        limit: Int?,
    ): ExpiringReport =
        client.send(
            ApiRequest.get(
                "reports/packages/expiring",
                query =
                    period.wire() +
                        listOfNotNull(
                            branchId?.let { "branchId" to it },
                            cursor?.let { "cursor" to it },
                            limit?.let { "limit" to it.toString() },
                        ),
            ),
        )

    override suspend fun usageReport(
        period: ReportPeriod,
        branchId: String?,
        groupBy: UsageGrouping,
    ): UsageReport =
        client.send(
            ApiRequest.get(
                "reports/packages/usage",
                query = period.wire() + listOfNotNull(branchId?.let { "branchId" to it }, "groupBy" to groupBy.wire),
            ),
        )
}

/**
 * Sunucu `@IsISO8601({ strict: true })` istiyor; UTC `Z` biçimi geçerli ve şube saatine
 * dönüşüm istemcide yapılmış oluyor (dönem sınırları `BranchClock` ile hesaplanıyor).
 */
private fun ReportPeriod.wire(): List<Pair<String, String>> =
    listOf("from" to DateTimeFormatter.ISO_INSTANT.format(from), "to" to DateTimeFormatter.ISO_INSTANT.format(to))

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
