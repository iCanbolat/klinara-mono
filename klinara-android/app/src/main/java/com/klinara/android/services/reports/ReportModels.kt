package com.klinara.android.services.reports

import com.klinara.android.services.crm.CustomerSource
import com.klinara.android.services.networking.PageInfo
import com.klinara.android.services.networking.WireEnumSerializer
import kotlinx.serialization.Serializable

// Kaynak: `apps/api/src/modules/reporting/dto/report.dto.ts`, `packages/shared/src/reports-api.ts`;
// iOS `ReportModels.swift` paritesi.
//
// ⚠️ HİÇBİR SAYI BURADA HESAPLANMIYOR. Oranlar, toplamlar ve yüzde değişimler sunucudan geldiği
// gibi taşınıyor (A5/A6'daki "bakiye istemcide hesaplanmaz" kuralı). Para `Long` kuruş; oranlar
// sunucunun iki haneye yuvarladığı yüzde (`Double` yalnız GÖSTERİM için — hesap yok).

/** Yanıtın kapsamı — istemci izinden TÜRETMEZ, sunucunun dediğini gösterir. */
@Serializable(with = ReportScopeSerializer::class)
enum class ReportScope(
    val wire: String,
) {
    All("all"),
    Own("own"),
    Unknown("unknown"),
    ;

    companion object {
        fun from(wire: String): ReportScope = entries.firstOrNull { it.wire == wire } ?: Unknown
    }
}

internal object ReportScopeSerializer : WireEnumSerializer<ReportScope>("ReportScope", ReportScope::from, { it.wire })

/** Sunucunun geri yansıttığı aralık — gönderildiği gibi. */
@Serializable
data class ReportPeriodEcho(
    val from: String,
    val to: String,
)

/**
 * Yüzde değişim: anahtar alan adı, değer göreli % (iki hane). **`null` ≠ `0`**: `null`
 * "karşılaştırılamaz" (önceki dönem 0, bu dönem değil); `0` yalnız ikisi de 0 iken gelir.
 * Anahtar kümesi rapora göre değişir — hiçbir anahtar varsayılmaz.
 */
typealias ReportDelta = Map<String, Double?>

/** Rapor sorgusu — sayfalamadan bağımsız kısım. */
data class ReportQuery(
    val period: ReportPeriod,
    /** `null` → sunucu "erişebildiğim şubeler"i kullanır (kiracının tamamı DEĞİL). */
    val branchId: String?,
    val compareToPrevious: Boolean = false,
)

/** Sayfalama isteğe bağlı: [limit] yoksa sunucu TÜM satırları döndürür. */
data class ReportPage(
    val limit: Int? = null,
    val cursor: String? = null,
) {
    companion object {
        val UNPAGED = ReportPage()
    }
}

/** Gruplamalar — sunucunun `*_GROUPINGS` kümeleri, Türkçe adlarla. */
enum class OccupancyGrouping(
    val wire: String,
    val turkishName: String,
) {
    Staff("staff", "Personel"),
    Branch("branch", "Şube"),
    Day("day", "Gün"),
}

enum class RevenueGrouping(
    val wire: String,
    val turkishName: String,
) {
    Service("service", "Hizmet"),
    Package("package", "Paket"),
    Staff("staff", "Personel"),
    Branch("branch", "Şube"),
    Day("day", "Gün"),
    Method("method", "Ödeme yöntemi"),
}

enum class NoShowGrouping(
    val wire: String,
    val turkishName: String,
) {
    Staff("staff", "Personel"),
    Branch("branch", "Şube"),
    Service("service", "Hizmet"),
    Day("day", "Gün"),
}

// --- Doluluk ---

@Serializable
data class OccupancyTotals(
    val bookedMinutes: Int = 0,
    val availableMinutes: Int = 0,
    /** Yüzde; mesai dışı randevu varsa **100'ü aşabilir**. */
    val occupancyRate: Double = 0.0,
)

@Serializable
data class OccupancyRow(
    /** Gün gruplamasında `null`; etiket o zaman `YYYY-MM-DD`. */
    val groupId: String? = null,
    val groupLabel: String,
    val bookedMinutes: Int = 0,
    val availableMinutes: Int = 0,
    val occupancyRate: Double = 0.0,
) {
    val id: String get() = groupId ?: groupLabel
}

@Serializable
data class OccupancyReport(
    val scope: ReportScope = ReportScope.All,
    val period: ReportPeriodEcho,
    val totals: OccupancyTotals,
    val data: List<OccupancyRow> = emptyList(),
    val pageInfo: PageInfo? = null,
    val previous: OccupancyTotals? = null,
    val delta: ReportDelta? = null,
)

// --- Ciro ---

@Serializable
data class RevenueTotals(
    val accruedMinor: Long = 0,
    val collectedMinor: Long = 0,
    val refundedMinor: Long = 0,
    val currency: String = "TRY",
)

@Serializable
data class RevenueRow(
    val groupId: String? = null,
    /** Atıfsız satırda `"—"`; yöntem kırılımında ham yöntem (`card`, `cash`…). */
    val groupLabel: String,
    /** Yöntem kırılımında HER ZAMAN 0: ödeme yöntemi bir tahsilat özelliği, kalem değil. */
    val accruedMinor: Long = 0,
    val collectedMinor: Long = 0,
) {
    val id: String get() = groupId ?: groupLabel
}

@Serializable
data class RevenueReport(
    val scope: ReportScope = ReportScope.All,
    val period: ReportPeriodEcho,
    val totals: RevenueTotals,
    val data: List<RevenueRow> = emptyList(),
    val pageInfo: PageInfo? = null,
    val previous: RevenueTotals? = null,
    val delta: ReportDelta? = null,
) {
    /**
     * Toplamlarda hareket var mı? iOS toplam kartını `data` boşken gizliyordu; oysa eski bir
     * borca bu dönemde yapılan tahsilat satırsız ama toplamlı bir dönem üretir.
     */
    val hasMovement: Boolean
        get() =
            data.isNotEmpty() ||
                listOf(totals.accruedMinor, totals.collectedMinor, totals.refundedMinor).any { it != 0L }
}

/** Ödeme yöntemi etiketleri — sunucunun `PaymentMethod` kümesi; bilinmeyen HAM kalır. */
object PaymentMethodLabels {
    private val LABELS =
        mapOf(
            "cash" to "Nakit",
            "card" to "Kart",
            "bank_transfer" to "Havale / EFT",
            "gift_voucher" to "Hediye çeki",
            "other" to "Diğer",
        )

    fun label(wire: String): String = LABELS[wire] ?: wire
}

// --- Personel performansı ---

@Serializable
data class StaffPerformanceRow(
    val staffProfileId: String,
    val staffName: String,
    val completedServices: Int = 0,
    val revenueMinor: Long = 0,
    /** Ters kayıtlar düşülmüş. */
    val commissionMinor: Long = 0,
    val bookedMinutes: Int = 0,
    val availableMinutes: Int = 0,
    val occupancyRate: Double = 0.0,
)

/** `totals`/`previous`/`delta` YOK — sunucu `compareTo`'yu bu raporda yok sayıyor. */
@Serializable
data class StaffPerformanceReport(
    val scope: ReportScope = ReportScope.All,
    val period: ReportPeriodEcho,
    val data: List<StaffPerformanceRow> = emptyList(),
    val pageInfo: PageInfo? = null,
    val currency: String = "TRY",
)

// --- Gelmeme ve iptal ---

@Serializable
data class NoShowTotals(
    val total: Int = 0,
    val completed: Int = 0,
    val noShow: Int = 0,
    val cancelled: Int = 0,
    val noShowRate: Double = 0.0,
    val cancellationRate: Double = 0.0,
)

@Serializable
data class NoShowRow(
    val groupId: String? = null,
    val groupLabel: String,
    val total: Int = 0,
    val completed: Int = 0,
    val noShow: Int = 0,
    val cancelled: Int = 0,
    val noShowRate: Double = 0.0,
    val cancellationRate: Double = 0.0,
) {
    val id: String get() = groupId ?: groupLabel
}

@Serializable
data class NoShowByOrigin(
    val origin: String,
    val total: Int = 0,
    val completed: Int = 0,
    val noShow: Int = 0,
    val cancelled: Int = 0,
    val noShowRate: Double = 0.0,
    val cancellationRate: Double = 0.0,
) {
    val turkishName: String get() = if (origin == "online") "Online" else "Klinikten"
}

/** `scope` alanı YOK — bu uç `appointment:read.all` istiyor, kendi kapsamı olmuyor. */
@Serializable
data class NoShowReport(
    val period: ReportPeriodEcho,
    val totals: NoShowTotals,
    val data: List<NoShowRow> = emptyList(),
    val pageInfo: PageInfo? = null,
    val byOrigin: List<NoShowByOrigin> = emptyList(),
    val previous: NoShowTotals? = null,
    val delta: ReportDelta? = null,
)

// --- Kazanım ve geri dönüş ---

@Serializable
data class RetentionTotals(
    val newCustomers: Int = 0,
    val returningCustomers: Int = 0,
    val activeCustomers: Int = 0,
    val returningRate: Double = 0.0,
)

@Serializable
data class AcquisitionRow(
    /** Müşteri kaynağı (`customers.source`); girilmemişse `null`. */
    val source: String? = null,
    val customers: Int = 0,
) {
    val id: String get() = source ?: UNKNOWN_ID

    /**
     * iOS ham değeri gösteriyordu (`instagram`); kaynak müşteri kartındaki enum'un aynısı, bu
     * yüzden kartla aynı Türkçe ad kullanılıyor. Tanınmayan değer ham kalır.
     */
    val turkishName: String
        get() {
            val raw = source ?: return "Belirtilmemiş"
            val known = CustomerSource.from(raw)
            return if (known == CustomerSource.Unknown) raw else known.turkishName
        }

    companion object {
        const val UNKNOWN_ID = "__unknown__"
    }
}

@Serializable
data class CohortReturn(
    val withinDays: Int,
    val returned: Int = 0,
    val rate: Double = 0.0,
)

/** Sayfasız; `scope` ve `pageInfo` YOK. Müşteri kimliği/telefonu hiç taşımaz. */
@Serializable
data class RetentionReport(
    val period: ReportPeriodEcho,
    val totals: RetentionTotals,
    val acquisition: List<AcquisitionRow> = emptyList(),
    val cohorts: List<CohortReturn> = emptyList(),
    val previous: RetentionTotals? = null,
    val delta: ReportDelta? = null,
)

/** Dışa aktarılabilir raporlar — sunucu yolları ve dosya adı öneki. */
enum class ReportKind(
    val path: String,
    val filePrefix: String,
) {
    Occupancy("occupancy", "doluluk"),
    Revenue("revenue", "ciro"),
    StaffPerformance("staff-performance", "personel-performans"),
    NoShow("no-show", "gelmeme"),
    Retention("retention", "kazanim"),
}
