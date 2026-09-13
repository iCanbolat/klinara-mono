package com.klinara.android.services.packages

import com.klinara.android.services.crm.MockCursor
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.PageInfo
import com.klinara.android.services.reports.ReportPeriod
import java.time.Instant
import kotlin.math.abs

/**
 * Paket raporlarının mock hesabı — defterin OKUNUR bir kopyası üzerinde.
 *
 * Sunucuda raporlar `modules/reporting`'te ve paket tablolarına yazmıyor; burada da
 * [MockPackagesService]'ten ayrı ve yalnız kopyaları görüyor. Tek bir sınıfta dört
 * controller'ın mock'u detekt'in büyük sınıf eşiğini aşıyordu ve eşiği susturmak yerine
 * sunucunun zaten çizdiği sınırdan bölündü.
 */
internal class MockPackageReports(
    private val packages: List<CustomerPackage>,
    private val ledger: Map<String, List<PackageLedgerEntry>>,
    private val customerNames: Map<String, String>,
) {
    fun outstanding(
        branchId: String?,
        groupBy: OutstandingGrouping,
    ): OutstandingReport {
        val open = packages.filter { it.isOpenWithBalance && (branchId == null || it.branchId == branchId) }
        val rows =
            open
                .flatMap { pkg -> pkg.items.filter { it.remainingSessions > 0 }.map { pkg to it } }
                .groupBy { (pkg, item) ->
                    when (groupBy) {
                        OutstandingGrouping.Service -> item.serviceId to item.serviceName
                        OutstandingGrouping.Customer -> pkg.customerId to (customerNames[pkg.customerId] ?: "Müşteri")
                        OutstandingGrouping.Branch -> pkg.branchId to branchName(pkg.branchId)
                    }
                }.map { (group, lines) ->
                    OutstandingRow(
                        groupId = group.first,
                        groupLabel = group.second,
                        packages = lines.map { it.first.id }.toSet().size,
                        remainingSessions = lines.sumOf { it.second.remainingSessions },
                        outstandingMinor = lines.sumOf { it.second.outstandingMinor },
                    )
                }.sortedByDescending { it.outstandingMinor }
        return OutstandingReport(
            totals =
                OutstandingTotals(
                    packages = open.size,
                    remainingSessions = rows.sumOf { it.remainingSessions },
                    outstandingMinor = rows.sumOf { it.outstandingMinor },
                ),
            data = rows,
        )
    }

    fun expiring(
        period: ReportPeriod,
        branchId: String?,
        cursor: String?,
        limit: Int?,
        canReadRevenue: Boolean,
    ): ExpiringReport {
        val size = (limit ?: DEFAULT_PAGE).coerceIn(1, MAX_PAGE)
        val after = cursor?.let { MockCursor.decode(it) ?: throw MockErrors.validation("cursor", "Geçersiz imleç.") }
        val rows =
            packages
                .asSequence()
                .filter { it.isOpenWithBalance && (branchId == null || it.branchId == branchId) }
                .mapNotNull { pkg -> pkg.expiresAt?.let { pkg to it } }
                // Aralık YARI AÇIK: `to` dahil DEĞİL.
                .filter { (_, expiresAt) -> !expiresAt.isBefore(period.from) && expiresAt.isBefore(period.to) }
                // Keyset sırası `(expiresAt, id)` artan: eşit tarihte `id` olmadan sayfa
                // sınırındaki kayıt ya iki kez çıkar ya hiç çıkmaz.
                .sortedWith(compareBy({ it.second }, { it.first.id }))
                .filter { (pkg, expiresAt) -> after == null || isAfter(expiresAt, pkg.id, after) }
                .map { (pkg, expiresAt) -> row(pkg, expiresAt, canReadRevenue) }
                .toList()
        val page = rows.take(size)
        val next = page.lastOrNull()?.takeIf { rows.size > size }
        return ExpiringReport(
            data = page,
            pageInfo =
                PageInfo(
                    nextCursor = next?.let { MockCursor.encode(it.expiresAt, it.customerPackageId) },
                    hasMore = next != null,
                ),
        )
    }

    fun usage(
        period: ReportPeriod,
        branchId: String?,
        groupBy: UsageGrouping,
    ): UsageReport {
        val buckets = linkedMapOf<Pair<String, String>, UsageRow>()
        packages
            .filter { branchId == null || it.branchId == branchId }
            .forEach { pkg ->
                ledger[pkg.id]
                    .orEmpty()
                    .filter { !it.createdAt.isBefore(period.from) && it.createdAt.isBefore(period.to) }
                    .forEach { entry ->
                        val key =
                            when (groupBy) {
                                UsageGrouping.Service -> entry.serviceId to entry.serviceName
                                UsageGrouping.Branch -> pkg.branchId to branchName(pkg.branchId)
                            }
                        val row = buckets[key] ?: UsageRow(groupId = key.first, groupLabel = key.second)
                        buckets[key] = row.adding(entry)
                    }
            }
        return UsageReport(buckets.values.sortedBy { it.groupLabel })
    }

    private fun row(
        pkg: CustomerPackage,
        expiresAt: Instant,
        canReadRevenue: Boolean,
    ) = ExpiringRow(
        customerPackageId = pkg.id,
        customerId = pkg.customerId,
        customerName = customerNames[pkg.customerId] ?: "Müşteri",
        packageName = pkg.name,
        branchId = pkg.branchId,
        remainingSessions = pkg.remainingSessions,
        expiresAt = expiresAt,
        // İzin yoksa sunucu parasal alanı `null`'lar — sıfır DEĞİL.
        outstandingMinor = pkg.outstandingMinor.takeIf { canReadRevenue },
    )

    /**
     * Defter satırını kullanım satırına ekler. Ters kayıt TÜKETİMDEN DÜŞER: geri alınmış
     * bir tamamlama "tüketildi" sayılmaz (tüketim −1, onun tersi +1 → net 0).
     */
    private fun UsageRow.adding(entry: PackageLedgerEntry): UsageRow {
        val count = abs(entry.delta)
        return when (entry.entryType) {
            LedgerEntryType.Purchase -> copy(purchased = purchased + count)
            LedgerEntryType.Consume -> copy(consumed = consumed - entry.delta)
            LedgerEntryType.Refund -> copy(refunded = refunded + count)
            LedgerEntryType.Expire -> copy(expired = expired + count)
            LedgerEntryType.TransferIn, LedgerEntryType.TransferOut -> copy(transferred = transferred + count)
            LedgerEntryType.ManualAdjustment, LedgerEntryType.Unknown -> copy(adjusted = adjusted + count)
        }
    }

    private fun isAfter(
        expiresAt: Instant,
        id: String,
        cursor: MockCursor,
    ): Boolean = expiresAt.isAfter(cursor.createdAt) || (expiresAt == cursor.createdAt && id > cursor.id)

    private fun branchName(branchId: String): String =
        when (branchId) {
            MockIds.BRANCH_NISANTASI -> "Nişantaşı"
            MockIds.BRANCH_BODRUM -> "Bodrum"
            else -> "Şube"
        }

    private companion object {
        const val DEFAULT_PAGE = 50
        const val MAX_PAGE = 200
    }
}
