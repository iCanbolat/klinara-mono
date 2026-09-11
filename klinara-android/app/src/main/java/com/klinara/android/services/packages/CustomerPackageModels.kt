package com.klinara.android.services.packages

import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Duration
import java.time.Instant

// Kaynak: `apps/api/src/modules/packages/dto/customer-package.dto.ts`.
//
// **Kalan hak defterden türetilir.** `remainingSessions` sunucuda trigger'la tutulan bir
// yansımadır; istemci onu OKUR ama kendi başına HESAPLAMAZ — yerelde toplayıp yazmak,
// defterin tek otorite olduğu kuralını bozardı ve Faz A5'in çıkış ölçütü ("istemci
// sayacı sunucu defteriyle ayrışmıyor") tam da bunun olmamasıdır.

/** `CUSTOMER_PACKAGE_STATUSES`. */
@Serializable(with = CustomerPackageStatusSerializer::class)
enum class CustomerPackageStatus(val wire: String) {
    Active("active"),
    Expired("expired"),
    Refunded("refunded"),
    Transferred("transferred"),

    /** Sunucu yeni bir durum eklerse kart açılamaz hâle gelmesin. Kapalı sayılır. */
    Unknown("unknown"),
    ;

    val turkishName: String
        get() =
            when (this) {
                Active -> "Aktif"
                Expired -> "Süresi doldu"
                Refunded -> "İade edildi"
                Transferred -> "Devredildi"
                Unknown -> "Bilinmeyen"
            }

    /** Yalnız aktif pakette tüketim, iade, devir ve düzeltme yapılabilir. */
    val isOpen: Boolean get() = this == Active

    companion object {
        fun from(wire: String): CustomerPackageStatus = entries.firstOrNull { it.wire == wire } ?: Unknown
    }
}

internal object CustomerPackageStatusSerializer : KSerializer<CustomerPackageStatus> {
    override val descriptor = PrimitiveSerialDescriptor("CustomerPackageStatus", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder) = CustomerPackageStatus.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: CustomerPackageStatus,
    ) = encoder.encodeString(value.wire)
}

/**
 * `ledger_entry_type` — defter satırının cinsi.
 *
 * [Unknown] kolu **zorunlu**: sunucu yeni bir tür eklediğinde eski istemci çözümlemede
 * patlarsa paket detayı hiç açılamaz. Bilinmeyen satır sessizce YUTULMUYOR da; deltasıyla
 * birlikte "bu sürümde adlandırılamayan işlem" olarak çiziliyor — eksik bir defter tam
 * görünmesin.
 */
@Serializable(with = LedgerEntryTypeSerializer::class)
enum class LedgerEntryType(val wire: String) {
    Purchase("purchase"),
    Consume("consume"),
    Refund("refund"),
    TransferIn("transfer_in"),
    TransferOut("transfer_out"),
    Expire("expire"),
    ManualAdjustment("manual_adjustment"),
    Unknown("unknown"),
    ;

    val turkishName: String
        get() =
            when (this) {
                Purchase -> "Satış"
                Consume -> "Kullanım"
                Refund -> "İade"
                TransferIn -> "Devir (gelen)"
                TransferOut -> "Devir (giden)"
                Expire -> "Süre dolumu"
                ManualAdjustment -> "Manuel düzeltme"
                Unknown -> "Bilinmeyen işlem"
            }

    companion object {
        fun from(wire: String): LedgerEntryType = entries.firstOrNull { it.wire == wire } ?: Unknown
    }
}

internal object LedgerEntryTypeSerializer : KSerializer<LedgerEntryType> {
    override val descriptor = PrimitiveSerialDescriptor("LedgerEntryType", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder) = LedgerEntryType.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: LedgerEntryType,
    ) = encoder.encodeString(value.wire)
}

/**
 * `CustomerPackageItemResponseDto`.
 *
 * **Bakiye kalem bazındadır.** 10 lazer + 2 bakım satılan bir pakette tek bir "kalan 12"
 * sayacı 12 seansın hepsinin lazer olarak tüketilmesine izin verirdi; ekran da bu yüzden
 * kalemleri ayrı ayrı gösterir.
 */
@Serializable
data class CustomerPackageItem(
    val id: String,
    val serviceId: String,
    /** Satış anındaki hizmet adı (snapshot) — katalogda ad değişse bile aldığı ne ise o. */
    val serviceName: String = "",
    val quantityTotal: Int = 0,
    val remainingSessions: Int = 0,
    /** Satış anındaki katalog birim fiyatı — yalnız gösterim. */
    val unitListPriceMinor: Long = 0,
    /** Satış tutarının bu kaleme tahsis edilen payı. İade/yükümlülük DAİMA buradan türer. */
    val itemTotalMinor: Long = 0,
    /** Kalan hakkın parasal karşılığı. */
    val outstandingMinor: Long = 0,
    val sortOrder: Int = 0,
) {
    val usedSessions: Int get() = (quantityTotal - remainingSessions).coerceAtLeast(0)

    /** Kullanım oranı (0…1) — ilerleme çubuğu için. Sıfır adetli kalem olmaz ama sıfıra bölmüyoruz. */
    val usedFraction: Float get() = if (quantityTotal > 0) usedSessions.toFloat() / quantityTotal else 0f

    /**
     * Satış anındaki tahsisin seans başına payı — iade/devir tutarının sunucudaki kuralı.
     * Tamsayı bölme, sunucudaki `floor` ile aynı.
     */
    val unitAllocationMinor: Long get() = if (quantityTotal > 0) itemTotalMinor / quantityTotal else 0
}

/** `CustomerPackageResponseDto` — satılmış paket (A5.2). */
@Serializable
data class CustomerPackage(
    val id: String,
    val customerId: String,
    val branchId: String,
    /** Tanım arşivlenmişse `null` olabilir — satış izi tanımdan bağımsız yaşar. */
    val definitionId: String? = null,
    /** Satış anındaki paket adı (snapshot). */
    val name: String,
    val definitionRevision: Int = 1,
    val totalPriceMinor: Long = 0,
    val currency: String = "TRY",
    val isTransferable: Boolean = true,
    val validityDays: Int? = null,
    @Serializable(with = InstantSerializer::class)
    val soldAt: Instant,
    /** `null` süresiz paket demektir. */
    @Serializable(with = InstantSerializer::class)
    val expiresAt: Instant? = null,
    val status: CustomerPackageStatus = CustomerPackageStatus.Active,
    /** Kalemlerin toplamı — SUNUCUNUN yansıması, istemcide hesaplanmaz. */
    val remainingSessions: Int = 0,
    val outstandingMinor: Long = 0,
    val refundedSessions: Int = 0,
    val refundAmountMinor: Long = 0,
    /** `pending` = borç doğdu, kasa hareketi Faz A6'da bağlanacak. */
    val refundSettlementStatus: String? = null,
    @Serializable(with = InstantSerializer::class)
    val refundedAt: Instant? = null,
    val refundReason: String? = null,
    val transferredFromPackageId: String? = null,
    val note: String? = null,
    /** `If-Match` için iyimser kilit sayacı. */
    val version: Int = 1,
    val items: List<CustomerPackageItem> = emptyList(),
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
) {
    val totalSessions: Int get() = items.sumOf { it.quantityTotal }

    val sortedItems: List<CustomerPackageItem> get() = items.sortedBy { it.sortOrder }

    /**
     * Süresi geçmiş mi — durum henüz `expired`'a çevrilmemiş olabilir: kapatma bir cron
     * işiyle yapılıyor (`package-expiry.worker.ts`). Ekran tarihe bakar, yalnız duruma değil.
     */
    fun isExpired(now: Instant): Boolean =
        status == CustomerPackageStatus.Expired || (expiresAt != null && !expiresAt.isAfter(now))

    /** Tüketilebilir mi — bağlama, iade ve devir buna bakar. */
    fun isConsumable(now: Instant): Boolean = status.isOpen && remainingSessions > 0 && !isExpired(now)

    /** Açık paket: kartın özeti bunları öne alır. */
    val isOpenWithBalance: Boolean get() = status.isOpen && remainingSessions > 0

    /** Süresi yaklaşıyor mu — varsayılan eşik bir ay (süre dolumu raporuyla aynı mantık). */
    fun expiresSoon(
        now: Instant,
        within: Duration = Duration.ofDays(EXPIRY_WARNING_DAYS),
    ): Boolean {
        val expiry = expiresAt ?: return false
        return isOpenWithBalance && expiry.isAfter(now) && !expiry.isAfter(now.plus(within))
    }

    /** İade edilmiş ama kasa hareketi henüz yok — ekran bunu gizlememeli. */
    val hasPendingRefundSettlement: Boolean get() = refundSettlementStatus == "pending"
}

/** Dosya düzeyinde: `private companion` üretilen `serializer()`'ı da gizlerdi. */
private const val EXPIRY_WARNING_DAYS = 30L

/**
 * `PackageLedgerEntryResponseDto` — append-only defterin bir satırı.
 *
 * Defter bir "işlem geçmişi" DEĞİL, kalan hakkın **kaynağıdır**: bir kalemin satırlarının
 * toplamı o kalemin kalan hakkıdır. Düzeltmeler silinmez, ters kayıt olarak eklenir —
 * "neden 6 değil 5?" sorusu ancak böyle cevaplanır.
 */
@Serializable
data class PackageLedgerEntry(
    val id: String,
    val customerPackageItemId: String,
    val serviceId: String,
    val serviceName: String = "",
    val entryType: LedgerEntryType = LedgerEntryType.Unknown,
    /** `purchase` +10, `consume` −1. */
    val delta: Int = 0,
    val appointmentId: String? = null,
    val actorUserId: String? = null,
    val reason: String? = null,
    /** Dolu ise bu satır bir düzeltmedir; işaret ettiği kaydı geri alır. */
    val reversesEntryId: String? = null,
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant,
) {
    val isReversal: Boolean get() = reversesEntryId != null

    /** "+3" / "−1" — işaret HER ZAMAN yazılır; "1" ile "+1" farkı hakkın yönüdür. */
    val signedDelta: String get() = if (delta > 0) "+$delta" else "$delta"
}

/** `CreateCustomerPackageDto` — satış. `X-Branch-Id` başlıktan gider, gövdede yok. */
data class CreateCustomerPackageInput(
    val customerId: String,
    val definitionId: String,
    val note: String? = null,
) {
    fun toJson(): JsonObject =
        buildJsonObject {
            put("customerId", customerId)
            put("definitionId", definitionId)
            note?.let { put("note", it) }
        }
}

/** `GET customers/:id/packages` sorgusu. */
data class CustomerPackageQuery(
    val cursor: String? = null,
    val limit: Int? = null,
    val status: CustomerPackageStatus? = null,
)
