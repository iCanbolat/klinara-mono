package com.klinara.android.services.scheduling

import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.time.Instant

// Bu dosyadaki tipler `apps/api/src/modules/scheduling/dto/scheduling.dto.ts` içindeki
// DTO'lardan birebir türetilmiştir.
//
// **Saat biçimi asimetrik:** sunucu `"09:00"` ALIR ama `"09:00:00"` DÖNER (Postgres `time`).
// Yanıt alanları bu yüzden `String?` tutulur ve [ClockTime.parse] ile okunur (ikisini de
// kabul ediyor); gövdeye daima [ClockTime.wireValue] (`HH:mm`) yazılır.

/**
 * Haftanın günü — sunucunun `dayOfWeek`'i, PostgreSQL `dow`: **0 = Pazar … 6 = Cumartesi**.
 * Gösterim sırası Pazartesi başlar ([displayOrder]).
 */
enum class Weekday(
    val turkishName: String,
    /**
     * Standart Türkçe kısaltma — ilk üç harf DEĞİL: "Pazartesi" ile "Pazar"ın ikisi de "Paz"
     * olurdu ve haftalık tekrar rozeti hangi günü kastettiğini söyleyemezdi (iOS'ta böyle).
     */
    val shortName: String,
) {
    Sunday("Pazar", "Paz"),
    Monday("Pazartesi", "Pzt"),
    Tuesday("Salı", "Sal"),
    Wednesday("Çarşamba", "Çar"),
    Thursday("Perşembe", "Per"),
    Friday("Cuma", "Cum"),
    Saturday("Cumartesi", "Cmt"),
    ;

    /** Sunucunun `dayOfWeek`'i. **Bildirim sırası kablo değeridir** — Pazar ilk, yer değiştirmeyin. */
    val dow: Int get() = ordinal

    companion object {
        val displayOrder: List<Weekday> = listOf(Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday)

        fun of(dow: Int): Weekday? = entries.firstOrNull { it.dow == dow }

        /** `java.time` Pazartesi = 1 … Pazar = 7 der; sunucu Pazar = 0. */
        fun of(day: java.time.DayOfWeek): Weekday = requireNotNull(of(day.value % DAYS_IN_WEEK))

        const val DAYS_IN_WEEK = 7
    }
}

/** `BranchHourResponseDto` — şubenin bir günü. Kapalı günde saatler `null`. */
@Serializable
data class BranchHour(
    val id: String = "",
    val branchId: String = "",
    val dayOfWeek: Int,
    val isClosed: Boolean = false,
    val openTime: String? = null,
    val closeTime: String? = null,
    val breakStartTime: String? = null,
    val breakEndTime: String? = null,
) {
    val open: ClockTime? get() = ClockTime.parse(openTime)
    val close: ClockTime? get() = ClockTime.parse(closeTime)
    val breakStart: ClockTime? get() = ClockTime.parse(breakStartTime)
    val breakEnd: ClockTime? get() = ClockTime.parse(breakEndTime)

    /** Mola iki uç birlikteyse; biri eksikse mola yok sayılır. */
    val breakRange: ClosedRange<ClockTime>?
        get() {
            val start = breakStart ?: return null
            val end = breakEnd ?: return null
            return start..end
        }
}

/** `GET branches/:id/hours` — zarf YOK, düz nesne. */
@Serializable
data class BranchHours(
    val branchId: String,
    val entries: List<BranchHour> = emptyList(),
)

/** `BranchHourInputDto`. Kapalı günde saat GÖNDERİLMEZ (sunucu 400); mola ikisi birlikte. */
data class BranchHourInput(
    val dayOfWeek: Int,
    val isClosed: Boolean,
    val open: ClockTime? = null,
    val close: ClockTime? = null,
    val breakStart: ClockTime? = null,
    val breakEnd: ClockTime? = null,
)

/** `PUT branches/:id/hours` — **tam 7 gün**, tam değiştirme. */
fun branchHoursBody(entries: List<BranchHourInput>): JsonObject =
    buildJsonObject {
        putJsonArray("entries") {
            entries.forEach { entry ->
                addJsonObject {
                    put("dayOfWeek", entry.dayOfWeek)
                    put("isClosed", entry.isClosed)
                    entry.open?.let { put("openTime", it.wireValue) }
                    entry.close?.let { put("closeTime", it.wireValue) }
                    entry.breakStart?.let { put("breakStartTime", it.wireValue) }
                    entry.breakEnd?.let { put("breakEndTime", it.wireValue) }
                }
            }
        }
    }

/** `StaffScheduleResponseDto` satırı — personelin bir şubedeki bir günü. */
@Serializable
data class StaffScheduleEntry(
    val id: String = "",
    val staffProfileId: String = "",
    val branchId: String = "",
    val dayOfWeek: Int,
    val isOff: Boolean = false,
    val startTime: String? = null,
    val endTime: String? = null,
) {
    val start: ClockTime? get() = ClockTime.parse(startTime)
    val end: ClockTime? get() = ClockTime.parse(endTime)
}

/**
 * `GET staff/:id/schedule?branchId=` — zarf YOK. Program **(personel, şube)** başınadır:
 * iki şubede çalışan personelin iki ayrı programı var. Kaydı olmayan gün, sunucunun uygunluk
 * motorunda "çalışmıyor" demek (slot yok).
 */
@Serializable
data class StaffSchedule(
    val staffProfileId: String,
    val branchId: String,
    val entries: List<StaffScheduleEntry> = emptyList(),
)

data class StaffScheduleEntryInput(
    val dayOfWeek: Int,
    val isOff: Boolean,
    val start: ClockTime? = null,
    val end: ClockTime? = null,
)

/** `PUT staff/:id/schedule` — `branchId` + tam 7 gün. */
fun staffScheduleBody(
    branchId: String,
    entries: List<StaffScheduleEntryInput>,
): JsonObject =
    buildJsonObject {
        put("branchId", branchId)
        putJsonArray("entries") {
            entries.forEach { entry ->
                addJsonObject {
                    put("dayOfWeek", entry.dayOfWeek)
                    put("isOff", entry.isOff)
                    entry.start?.let { put("startTime", it.wireValue) }
                    entry.end?.let { put("endTime", it.wireValue) }
                }
            }
        }
    }

/** İstisnanın tekrarı. [Unknown] — yarın eklenecek bir tür listeyi düşürmesin. */
@Serializable(with = ScheduleRecurrenceSerializer::class)
enum class ScheduleRecurrence(
    val wire: String,
    val turkishName: String,
) {
    None("none", "Tekrar yok"),
    Weekly("weekly", "Haftalık"),
    Unknown("unknown", "Bilinmeyen tekrar"),
    ;

    companion object {
        fun from(wire: String): ScheduleRecurrence = entries.firstOrNull { it.wire == wire } ?: Unknown

        val selectable: List<ScheduleRecurrence> = listOf(None, Weekly)
    }
}

internal object ScheduleRecurrenceSerializer : KSerializer<ScheduleRecurrence> {
    override val descriptor = PrimitiveSerialDescriptor("ScheduleRecurrence", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): ScheduleRecurrence = ScheduleRecurrence.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: ScheduleRecurrence,
    ) = encoder.encodeString(value.wire)
}

/**
 * `ScheduleExceptionResponseDto` — izin, tatil, yarım gün. **Yalnız zaman ÇIKARIR**;
 * haftalık şablonun üstüne yazılan bir "müsait değil" aralığı.
 *
 * Düzenleme yok (sunucuda PATCH yok): değiştirmek = kaldırıp yeniden oluşturmak; arayüz
 * bunu "düzenle" gibi taklit etmez.
 */
@Serializable
data class ScheduleException(
    val id: String,
    val tenantId: String = "",
    val staffProfileId: String,
    val branchId: String,
    @Serializable(with = InstantSerializer::class)
    val startsAt: Instant,
    @Serializable(with = InstantSerializer::class)
    val endsAt: Instant,
    val reason: String? = null,
    val recurrenceType: ScheduleRecurrence = ScheduleRecurrence.None,
    val recurrenceIntervalWeeks: Int = 1,
    @Serializable(with = InstantSerializer::class)
    val recurrenceUntil: Instant? = null,
    val recurrenceWeekdays: List<Int> = emptyList(),
    val isActive: Boolean = true,
)

/**
 * `ScheduleExceptionInputDto`. Zaman damgaları **şube offset'iyle** ISO 8601
 * (`BranchClock.wireValue`) — cihazın dilimi değil.
 *
 * `none`'da tekrar alanları GÖNDERİLMEZ: sunucu tek seferlik istisnada `recurrenceUntil`'i
 * ve dolu bir gün listesini 400 ile reddediyor.
 */
data class ScheduleExceptionInput(
    val staffProfileId: String,
    val branchId: String,
    val startsAt: String,
    val endsAt: String,
    val reason: String? = null,
    val recurrenceType: ScheduleRecurrence = ScheduleRecurrence.None,
    val recurrenceIntervalWeeks: Int? = null,
    val recurrenceUntil: String? = null,
    val recurrenceWeekdays: List<Int> = emptyList(),
) {
    fun toJson(): JsonObject =
        buildJsonObject {
            put("staffProfileId", staffProfileId)
            put("branchId", branchId)
            put("startsAt", startsAt)
            put("endsAt", endsAt)
            reason?.let { put("reason", it) }
            put("recurrenceType", recurrenceType.wire)
            if (recurrenceType == ScheduleRecurrence.Weekly) {
                recurrenceIntervalWeeks?.let { put("recurrenceIntervalWeeks", it) }
                recurrenceUntil?.let { put("recurrenceUntil", it) }
                put("recurrenceWeekdays", JsonArray(recurrenceWeekdays.sorted().map(::JsonPrimitive)))
            }
            put("isActive", true)
        }
}

/**
 * `GET schedule-exceptions` sorgusu. ⚠️ Sunucu `from`/`to`'yu yalnız `startsAt` ile
 * karşılaştırıyor (örtüşme değil): aralıktan önce başlayıp içine uzanan bir istisna —
 * özellikle haftalık tekrar — listede görünmez. `API_DEVELOPMENT.md` açık sorusu.
 */
data class ScheduleExceptionQuery(
    val branchId: String,
    val staffProfileId: String? = null,
    val from: Instant? = null,
    val to: Instant? = null,
)
