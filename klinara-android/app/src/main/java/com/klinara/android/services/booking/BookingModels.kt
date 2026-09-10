package com.klinara.android.services.booking

import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant

/**
 * Randevu durumu.
 *
 * **Sunucu bunu `string` olarak yazıyor**, enum olarak değil (`clinic-api.ts` bunu
 * açıkça uyarıyor). Bilinmeyen bir değeri körlemesine enum'a çevirmek, sunucuya yeni
 * bir durum eklendiği gün takvimin TAMAMINI çözümleme hatasıyla düşürürdü — üstelik
 * o randevu yalnız bir satır. [Unknown] dalı o günü bir boş listeye değil, bir
 * "bilinmeyen durum" rozetine çevirir.
 */
@Serializable(with = AppointmentStatusSerializer::class)
enum class AppointmentStatus(val wire: String) {
    Scheduled("scheduled"),
    Confirmed("confirmed"),
    Arrived("arrived"),
    InProgress("in_progress"),
    Completed("completed"),
    NoShow("no_show"),
    Cancelled("cancelled"),

    /** Sunucu tanımadığımız bir durum gönderdi. Ekranda görünür, aksiyon üretmez. */
    Unknown("unknown"),
    ;

    val turkishName: String
        get() =
            when (this) {
                Scheduled -> "Planlandı"
                Confirmed -> "Onaylandı"
                Arrived -> "Geldi"
                InProgress -> "İşlemde"
                Completed -> "Tamamlandı"
                NoShow -> "Gelmedi"
                Cancelled -> "İptal"
                Unknown -> "Bilinmeyen durum"
            }

    val badgeTone: KlinaraBadgeTone
        get() =
            when (this) {
                Scheduled -> KlinaraBadgeTone.Neutral
                Confirmed, Arrived, InProgress -> KlinaraBadgeTone.Positive
                Completed, Cancelled, Unknown -> KlinaraBadgeTone.Muted
                NoShow -> KlinaraBadgeTone.Warning
            }

    /**
     * Bu durumdan gidilebilecek durumlar — sunucunun durum makinesiyle **birebir**
     * (`API_DEVELOPMENT.md` §"Durum makinesi"; sunucuda hem serviste hem DB trigger'ında
     * uygulanıyor).
     *
     * `Cancelled` listeden ÇIKARILIR: iptalin kendi sebep toplayan akışı ve kendi ucu
     * var (`POST appointments/:id/cancel`). Durum listesinde de göstermek, aynı işe iki
     * kapı açıp birinden sebep sormamak olurdu.
     *
     * `Unknown` hiçbir geçiş üretmez: tanımadığımız bir durumdan nereye gidilebileceğini
     * de bilmiyoruz ve tahmin etmek sunucuda 409 yer.
     */
    fun allowedTransitions(canReopen: Boolean): List<AppointmentStatus> =
        when (this) {
            Scheduled -> listOf(Confirmed, Arrived, NoShow)
            Confirmed -> listOf(Arrived, NoShow)
            Arrived -> listOf(InProgress, NoShow)
            InProgress -> listOf(Completed)
            // `appointment:reopen` ayrı bir izin: tamamlanmış bir randevuyu yeniden
            // açmak sunucuda ters kayıt üretiyor (defter düzeltmesi).
            Completed -> if (canReopen) listOf(InProgress) else emptyList()
            NoShow, Cancelled, Unknown -> emptyList()
        }

    /** İptal edilmiş, gelmemiş ve tamamlanmış randevu ERTELENEMEZ (sunucu `assertMutable`). */
    val canReschedule: Boolean
        get() = this != Cancelled && this != NoShow && this != Completed && this != Unknown

    /**
     * Kapanmış randevu: takvimde sütun REZERVE ETMEZ, tam genişlikte soluk çizilir.
     *
     * [Unknown] terminal SAYILMAZ: bilmediğimiz bir durumu kapanmış varsaymak,
     * yeni bir "beklemede" durumunu sessizce iptal gibi göstermek olurdu.
     */
    val isTerminal: Boolean get() = this == NoShow || this == Cancelled

    companion object {
        fun from(wire: String): AppointmentStatus = entries.firstOrNull { it.wire == wire } ?: Unknown
    }
}

internal object AppointmentStatusSerializer : KSerializer<AppointmentStatus> {
    override val descriptor = PrimitiveSerialDescriptor("AppointmentStatus", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): AppointmentStatus = AppointmentStatus.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: AppointmentStatus,
    ) = encoder.encodeString(value.wire)
}

/** Randevunun nereden geldiği. Yalnız [Online] ekranda ayrıca söylenir. */
@Serializable
enum class AppointmentOrigin {
    @SerialName("internal")
    Internal,

    @SerialName("online")
    Online,
    ;

    val turkishName: String get() = if (this == Internal) "Klinik" else "Online"
}

/**
 * Takvim/liste satırı — `CalendarEntryDto`.
 *
 * Detay DTO'sundan **bilerek farklı**: müşteri adını ve hizmet adını taşır (takvim
 * onlarsız çizilemez) ama `origin`, `cancellationReason`, tampon süreleri ve
 * `createdAt` taşımaz. Detay ekranı bu yüzden ayrıca `GET appointments/:id` çağırır.
 */
@Serializable
data class CalendarEntry(
    val id: String,
    val branchId: String,
    val customerId: String,
    val customerName: String,
    val customerPhone: String? = null,
    val status: AppointmentStatus,
    @Serializable(with = InstantSerializer::class) val startsAt: Instant,
    @Serializable(with = InstantSerializer::class) val endsAt: Instant,
    val notes: String? = null,
    val version: Int = 0,
    val totalMinor: Long = 0,
    val services: List<CalendarEntryServiceLine> = emptyList(),
) {
    /** "Lazer epilasyon + Cilt bakımı" — uygulanma sırasıyla. */
    val serviceSummary: String
        get() = services.sortedBy { it.sortOrder }.joinToString(" + ") { it.serviceName }

    /** Sıra korunarak tekilleştirilir; ilk sıradaki personel bloğun rengini verir. */
    val staffProfileIds: List<String>
        get() = services.sortedBy { it.sortOrder }.map { it.staffProfileId }.distinct()
}

@Serializable
data class CalendarEntryServiceLine(
    val id: String,
    val serviceId: String,
    val serviceName: String,
    val staffProfileId: String,
    val sortOrder: Int = 0,
    @Serializable(with = InstantSerializer::class) val startsAt: Instant,
    @Serializable(with = InstantSerializer::class) val endsAt: Instant,
    val priceMinor: Long = 0,
)

/**
 * Yoğunluk kovası.
 *
 * [localDay] bir ZAMAN DAMGASI DEĞİL, çıplak bir yerel tarih (`"2026-09-07"`) ve
 * **String kalır**. Cihaz saat diliminde parse edilirse gün sınırındaki kovalar bir
 * gün kayar; şube diliminde yorumlamak da gereksiz — anahtar olarak kullanılıyor.
 */
@Serializable
data class DensityBucket(
    val localDay: String,
    val localHour: Int,
    val appointmentCount: Int,
)

/** `GET calendar/day` · `GET calendar/week` · `GET calendar/staff` — üçü de aynı gövde. */
@Serializable
data class CalendarResponse(
    val branchId: String,
    val timezone: String,
    @Serializable(with = InstantSerializer::class) val from: Instant,
    @Serializable(with = InstantSerializer::class) val to: Instant,
    val appointments: List<CalendarEntry> = emptyList(),
    val density: List<DensityBucket> = emptyList(),
)

/**
 * Randevu detayı — `AppointmentResponseDto`.
 *
 * [CalendarEntry]'den farkı **bilerek**: `origin`, `cancellationReason`, tampon süreleri
 * ve `createdAt` yalnız burada. Detay ekranı bu yüzden takvim satırıyla yetinmez,
 * `GET appointments/:id` çağırır — ve aynı çağrı taze bir [version] getirir ki
 * `If-Match` bayat kalmasın.
 */
@Serializable
data class Appointment(
    val id: String,
    val tenantId: String,
    val branchId: String,
    val customerId: String,
    val status: AppointmentStatus,
    @Serializable(with = InstantSerializer::class) val startsAt: Instant,
    @Serializable(with = InstantSerializer::class) val endsAt: Instant,
    val origin: AppointmentOrigin = AppointmentOrigin.Internal,
    val notes: String? = null,
    val cancellationReason: String? = null,
    val version: Int = 0,
    val totalMinor: Long = 0,
    @Serializable(with = InstantSerializer::class) val createdAt: Instant,
    val services: List<AppointmentServiceLine> = emptyList(),
) {
    /** Görünen süre — müşterinin gördüğü. */
    val visibleMinutes: Int get() = services.sumOf { it.durationMinutes }

    /**
     * Kaynağın gerçekten TUTULDUĞU süre: tamponlar dahil.
     *
     * Tamponlar `appointments` tablosunda değil `resource_bookings.time_range`'de yaşar;
     * müşteri 14:00 görür, takvim 13:55–15:10 tutar. Bu fark ekranda açıkça söylenmeli,
     * yoksa "boş görünen" bir aralığa randevu verilmeye çalışılır.
     */
    val occupiedMinutes: Int get() = services.sumOf { it.occupiedMinutes }
}

@Serializable
data class AppointmentServiceLine(
    val id: String,
    val serviceId: String,
    val staffProfileId: String,
    val sortOrder: Int = 0,
    @Serializable(with = InstantSerializer::class) val startsAt: Instant,
    @Serializable(with = InstantSerializer::class) val endsAt: Instant,
    val durationMinutes: Int = 0,
    val bufferBeforeMinutes: Int = 0,
    val bufferAfterMinutes: Int = 0,
    val priceMinor: Long = 0,
    val vatRateBasisPoints: Int = 0,
    /** Doluysa tamamlandığında paketten bir seans düşecek. */
    val customerPackageItemId: String? = null,
) {
    val occupiedMinutes: Int get() = bufferBeforeMinutes + durationMinutes + bufferAfterMinutes
}

/** Denetim izi olayı — `AppointmentHistoryEntryDto`. */
@Serializable
data class AppointmentHistoryEntry(
    val id: String,
    val action: AppointmentHistoryAction,
    val actorUserId: String? = null,
    val fromStatus: AppointmentStatus? = null,
    val toStatus: AppointmentStatus? = null,
    @Serializable(with = InstantSerializer::class) val oldStartsAt: Instant? = null,
    @Serializable(with = InstantSerializer::class) val newStartsAt: Instant? = null,
    val reason: String? = null,
    /** **UTC** — `startsAt` gibi şube offset'li DEĞİL. Gösterim yine `BranchClock` ile. */
    @Serializable(with = InstantSerializer::class) val createdAt: Instant,
)

/** Bilinmeyen bir eylem çözümlemeyi düşürmemeli; [Unknown] o dalı taşır. */
@Serializable(with = AppointmentHistoryActionSerializer::class)
enum class AppointmentHistoryAction(val wire: String) {
    Created("created"),
    Rescheduled("rescheduled"),
    StatusChanged("status_changed"),
    Cancelled("cancelled"),
    Updated("updated"),
    Unknown("unknown"),
    ;

    val turkishName: String
        get() =
            when (this) {
                Created -> "Oluşturuldu"
                Rescheduled -> "Ertelendi"
                StatusChanged -> "Durum değişti"
                Cancelled -> "İptal edildi"
                Updated -> "Güncellendi"
                Unknown -> "Değişiklik"
            }

    companion object {
        fun from(wire: String): AppointmentHistoryAction = entries.firstOrNull { it.wire == wire } ?: Unknown
    }
}

internal object AppointmentHistoryActionSerializer : KSerializer<AppointmentHistoryAction> {
    override val descriptor = PrimitiveSerialDescriptor("AppointmentHistoryAction", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): AppointmentHistoryAction =
        AppointmentHistoryAction.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: AppointmentHistoryAction,
    ) = encoder.encodeString(value.wire)
}

/** `GET availability` yanıtı. */
@Serializable
data class AvailabilityResponse(
    val branchId: String,
    val timezone: String,
    val slotGranularityMinutes: Int = 0,
    val slots: List<AvailabilitySlot> = emptyList(),
)

/**
 * Uygun bir başlangıç. [staffProfileIds] o slotu verebilecek **adayların** listesidir,
 * tekil bir kimlik değil — bir slot birden çok personelle mümkün olabilir.
 */
@Serializable
data class AvailabilitySlot(
    @Serializable(with = InstantSerializer::class) val startsAt: Instant,
    @Serializable(with = InstantSerializer::class) val endsAt: Instant,
    val staffProfileIds: List<String> = emptyList(),
) {
    fun supports(staffProfileId: String?): Boolean =
        staffProfileId == null || staffProfileId in staffProfileIds
}

/**
 * `GET availability` sorgusu.
 *
 * [serviceIds] **SIRASI ANLAMLIDIR**: hizmetler gönderilen sırayla ardışık uygulanıyor
 * ve toplam süre buna göre hesaplanıyor. Sunucu en fazla 10 kabul ediyor.
 */
data class AvailabilityQuery(
    val branchId: String,
    val serviceIds: List<String>,
    val from: Instant,
    val to: Instant,
    val staffProfileId: String? = null,
)

/** Randevu satırı girdisi. */
@Serializable
data class AppointmentServiceInput(
    val serviceId: String,
    val staffProfileId: String,
    /** Doluysa tamamlandığında paketten bir seans düşer (A5.2). */
    val customerPackageItemId: String? = null,
)

/** `POST appointments` gövdesi. Şube **gövdede**; bu uç `X-Branch-Id` kapsamı istemiyor. */
@Serializable
data class CreateAppointmentInput(
    val branchId: String,
    val customerId: String,
    /** Şube offset'li ISO 8601 — `BranchClock.wireValue`. */
    val startsAt: String,
    val services: List<AppointmentServiceInput>,
    val notes: String? = null,
)

/** `POST appointments/:id/reschedule` gövdesi. [services] atlanırsa mevcut dizilim korunur. */
@Serializable
data class RescheduleAppointmentInput(
    val startsAt: String,
    val services: List<AppointmentServiceInput>? = null,
    val reason: String? = null,
)

/** `GET calendar/day` sorgusu. [date] ŞUBE dilimindeki yerel tarih. */
data class CalendarDayQuery(
    val branchId: String,
    val date: String,
    val staffProfileId: String? = null,
)

/** `GET calendar/week` sorgusu. [weekStart] haftanın ilk günü (Pazartesi). */
data class CalendarWeekQuery(
    val branchId: String,
    val weekStart: String,
    val staffProfileId: String? = null,
)

/** `GET appointments` sorgusu — imleç tabanlı sayfalama. */
data class AppointmentListQuery(
    val from: Instant,
    val to: Instant,
    val branchId: String? = null,
    val customerId: String? = null,
    val staffProfileId: String? = null,
    val statuses: List<AppointmentStatus> = emptyList(),
    val limit: Int? = null,
    val cursor: String? = null,
)
