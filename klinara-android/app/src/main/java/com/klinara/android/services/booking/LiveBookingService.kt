package com.klinara.android.services.booking

import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Canlı takvim servisi.
 *
 * Tarih parametreleri iki ayrı biçimde gider ve **birbirinin yerine geçemez**:
 * takvim uçları çıplak yerel tarih (`2026-09-07`) ister, `appointments` offset'li
 * ISO 8601 (`2026-09-07T00:00:00+03:00`). Sunucu ikisini de `@Matches`/`@IsISO8601`
 * ile doğruluyor; karıştırmak 400 verir.
 */
@Serializable
private data class ReasonBody(val reason: String? = null)

@Serializable
private data class ChangeStatusBody(
    val status: String,
    val reason: String? = null,
)

class LiveBookingService internal constructor(
    private val client: ApiClient,
    private val clock: BranchClock,
) : BookingService {
    override suspend fun calendarDay(query: CalendarDayQuery): CalendarResponse =
        client.send(
            ApiRequest.get(
                "calendar/day",
                query =
                    buildList {
                        add("branchId" to query.branchId)
                        add("date" to query.date)
                        query.staffProfileId?.let { add("staffProfileId" to it) }
                    },
            ),
        )

    override suspend fun calendarWeek(query: CalendarWeekQuery): CalendarResponse =
        client.send(
            ApiRequest.get(
                "calendar/week",
                query =
                    buildList {
                        add("branchId" to query.branchId)
                        add("weekStart" to query.weekStart)
                        query.staffProfileId?.let { add("staffProfileId" to it) }
                    },
            ),
        )

    override suspend fun appointment(id: String): Appointment = client.send(ApiRequest.get("appointments/$id"))

    override suspend fun history(id: String): List<AppointmentHistoryEntry> =
        client.send<ListEnvelope<AppointmentHistoryEntry>>(ApiRequest.get("appointments/$id/history")).data

    override suspend fun updateNotes(
        id: String,
        version: Int,
        notes: String?,
    ): Appointment {
        // `KlinaraJson`'ın `explicitNulls = false` ayarı null alanları ATLAR ve sunucu
        // eksik `notes`'u "değiştirme" saymaz — tam tersine, DTO'su `string | null`
        // beklediği için notu silmenin TEK yolu açık bir `null`. Bu yüzden gövde elle
        // kuruluyor; `encodeToString(UpdateNotesBody(null))` boş bir `{}` üretirdi.
        val body =
            buildJsonObject {
                if (notes == null) put("notes", JsonNull) else put("notes", notes)
            }
        return client.send(
            ApiRequest.patch(
                "appointments/$id",
                body = RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), body)),
                ifMatch = ApiRequest.weakETag(version),
            ),
        )
    }

    override suspend fun cancel(
        id: String,
        reason: String?,
    ): Appointment =
        client.send(
            ApiRequest.post(
                "appointments/$id/cancel",
                body = RequestBodyPayload(KlinaraJson.encodeToString(ReasonBody(reason))),
            ),
        )

    override suspend fun changeStatus(
        id: String,
        status: AppointmentStatus,
        reason: String?,
    ): Appointment =
        client.send(
            ApiRequest.post(
                "appointments/$id/status",
                body = RequestBodyPayload(KlinaraJson.encodeToString(ChangeStatusBody(status.wire, reason))),
            ),
        )

    override suspend fun availability(query: AvailabilityQuery): AvailabilityResponse =
        client.send(
            ApiRequest.get(
                "availability",
                query =
                    buildList {
                        add("branchId" to query.branchId)
                        // Sunucu hem virgüllü hem tekrarlı parametre kabul ediyor;
                        // virgüllü biçim SIRAYI korur ve iOS ile aynı.
                        add("serviceIds" to query.serviceIds.joinToString(","))
                        add("from" to clock.wireValue(query.from))
                        add("to" to clock.wireValue(query.to))
                        query.staffProfileId?.let { add("staffProfileId" to it) }
                    },
            ),
        )

    override suspend fun create(
        input: CreateAppointmentInput,
        idempotencyKey: String,
    ): Appointment =
        client.send(
            ApiRequest.post(
                "appointments",
                body = RequestBodyPayload(KlinaraJson.encodeToString(input)),
                idempotencyKey = idempotencyKey,
            ),
        )

    override suspend fun reschedule(
        id: String,
        version: Int,
        input: RescheduleAppointmentInput,
    ): Appointment =
        client.send(
            ApiRequest.post(
                "appointments/$id/reschedule",
                body = RequestBodyPayload(KlinaraJson.encodeToString(input)),
                ifMatch = ApiRequest.weakETag(version),
            ),
        )

    override suspend fun appointments(query: AppointmentListQuery): Page<CalendarEntry> =
        client.send(
            ApiRequest.get(
                "appointments",
                query =
                    buildList {
                        add("from" to clock.wireValue(query.from))
                        add("to" to clock.wireValue(query.to))
                        query.branchId?.let { add("branchId" to it) }
                        query.customerId?.let { add("customerId" to it) }
                        query.staffProfileId?.let { add("staffProfileId" to it) }
                        // Sunucu hem `?status=a,b` hem tekrarlı parametre kabul ediyor;
                        // virgüllü biçim tek satır ve iOS ile aynı.
                        if (query.statuses.isNotEmpty()) {
                            add("status" to query.statuses.joinToString(",") { it.wire })
                        }
                        query.limit?.let { add("limit" to it.toString()) }
                        query.cursor?.let { add("cursor" to it) }
                    },
            ),
        )
}
