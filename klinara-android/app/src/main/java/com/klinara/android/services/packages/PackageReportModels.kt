package com.klinara.android.services.packages

import com.klinara.android.services.networking.InstantSerializer
import com.klinara.android.services.networking.PageInfo
import kotlinx.serialization.Serializable
import java.time.Instant

// Kaynak: `apps/api/src/modules/reporting/dto/package-report.dto.ts`.
//
// **Tarih aralıkları yarı açıktır: `[from, to)`.** Ay raporu için `to` ayın son günü
// DEĞİL, ertesi ayın ilk anıdır; "son gün eksik" hatası bu ayrımın unutulmasından çıkar.

/** Taşınan yükümlülüğün kırılımı. */
enum class OutstandingGrouping(val wire: String, val turkishName: String) {
    Service("service", "Hizmet"),
    Customer("customer", "Müşteri"),
    Branch("branch", "Şube"),
}

/** Dönem kullanımının kırılımı — müşteri bazında kullanım yok (sunucu da sunmuyor). */
enum class UsageGrouping(val wire: String, val turkishName: String) {
    Service("service", "Hizmet"),
    Branch("branch", "Şube"),
}

/** `OutstandingRowDto`. */
@Serializable
data class OutstandingRow(
    /** Kırılım silinmiş bir kayda düşerse `null` gelebilir. */
    val groupId: String? = null,
    val groupLabel: String = "",
    val packages: Int = 0,
    val remainingSessions: Int = 0,
    /** Satış anındaki tahsisten hesaplanan yükümlülük. */
    val outstandingMinor: Long = 0,
) {
    val key: String get() = groupId ?: groupLabel
}

@Serializable
data class OutstandingTotals(
    val packages: Int = 0,
    val remainingSessions: Int = 0,
    val outstandingMinor: Long = 0,
    val currency: String = "TRY",
)

/**
 * `GET reports/packages/outstanding` — kliniğin taşıdığı BORÇ, gelir değil.
 * **`report.revenue:read`** ister; izni olmayan rol bu raporun girişini hiç görmez.
 */
@Serializable
data class OutstandingReport(
    val totals: OutstandingTotals = OutstandingTotals(),
    val data: List<OutstandingRow> = emptyList(),
)

/** `ExpiringRowDto`. */
@Serializable
data class ExpiringRow(
    val customerPackageId: String,
    val customerId: String,
    val customerName: String = "",
    val packageName: String = "",
    val branchId: String,
    val remainingSessions: Int = 0,
    @Serializable(with = InstantSerializer::class)
    val expiresAt: Instant,
    /**
     * YALNIZ `report.revenue:read` izniyle dolu gelir; izin yoksa sunucu `null` döner.
     * Ekran `null`'u **"—"** yazar, "0 ₺" DEĞİL: sıfır, taşınmayan bir borç iddiasıdır.
     */
    val outstandingMinor: Long? = null,
)

/** `GET reports/packages/expiring` — `package:read`, cursor sayfalı, `(expiresAt, id)` artan. */
@Serializable
data class ExpiringReport(
    val data: List<ExpiringRow> = emptyList(),
    val pageInfo: PageInfo = PageInfo(),
)

/** `UsageRowDto` — defterden hesaplanır; ters kayıtlar toplamdan DÜŞÜLMÜŞTÜR. */
@Serializable
data class UsageRow(
    val groupId: String? = null,
    val groupLabel: String = "",
    val purchased: Int = 0,
    val consumed: Int = 0,
    val refunded: Int = 0,
    val expired: Int = 0,
    val transferred: Int = 0,
    val adjusted: Int = 0,
) {
    val key: String get() = groupId ?: groupLabel
}

/** `GET reports/packages/usage` — `package:read`. */
@Serializable
data class UsageReport(
    val data: List<UsageRow> = emptyList(),
)

