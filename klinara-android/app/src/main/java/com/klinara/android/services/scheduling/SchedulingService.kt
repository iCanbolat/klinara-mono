package com.klinara.android.services.scheduling

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject
import java.time.format.DateTimeFormatter

/**
 * Çalışma saatleri, personel programı ve istisnalar — `schedule:read` okur, `:write` yazar.
 *
 * Bütün uçlar `@RequireBranchScope`: `X-Branch-Id` başlığı zorunlu (yoksa 400). Başlığı
 * `ApiClient` interceptor'ı `TokenStore`'dan ekliyor; ekran yalnız bir şube seçili değilken
 * çağırmamalı. PUT'lar **tam değiştirme** (7 gün); ekranlar yerel taslakta çalışıp tek
 * seferde kaydeder. Tatil (`holidays`) uçları iOS'ta kullanılmıyor — burada da yok (parite).
 */
interface SchedulingService {
    /** `GET branches/:id/hours`. */
    suspend fun branchHours(branchId: String): BranchHours

    /** `PUT branches/:id/hours` — tam 7 gün. */
    suspend fun replaceBranchHours(
        branchId: String,
        entries: List<BranchHourInput>,
    ): BranchHours

    /** `GET staff/:id/schedule?branchId=`. Kaydı olmayan personel için boş `entries`. */
    suspend fun staffSchedule(
        staffProfileId: String,
        branchId: String,
    ): StaffSchedule

    /** `PUT staff/:id/schedule` — tam 7 gün. */
    suspend fun replaceStaffSchedule(
        staffProfileId: String,
        branchId: String,
        entries: List<StaffScheduleEntryInput>,
    ): StaffSchedule

    /** `GET schedule-exceptions`. */
    suspend fun exceptions(query: ScheduleExceptionQuery): List<ScheduleException>

    /** `POST schedule-exceptions`. */
    suspend fun createException(input: ScheduleExceptionInput): ScheduleException

    /** `DELETE schedule-exceptions/:id` — **204**, gövde yok (yumuşak silme). */
    suspend fun deleteException(id: String)
}

class LiveSchedulingService internal constructor(
    private val client: ApiClient,
) : SchedulingService {
    override suspend fun branchHours(branchId: String): BranchHours =
        client.send(ApiRequest.get("branches/$branchId/hours"))

    override suspend fun replaceBranchHours(
        branchId: String,
        entries: List<BranchHourInput>,
    ): BranchHours = client.send(ApiRequest.put("branches/$branchId/hours", body = branchHoursBody(entries).asBody()))

    override suspend fun staffSchedule(
        staffProfileId: String,
        branchId: String,
    ): StaffSchedule =
        client.send(ApiRequest.get("staff/$staffProfileId/schedule", query = listOf("branchId" to branchId)))

    override suspend fun replaceStaffSchedule(
        staffProfileId: String,
        branchId: String,
        entries: List<StaffScheduleEntryInput>,
    ): StaffSchedule =
        client.send(
            ApiRequest.put("staff/$staffProfileId/schedule", body = staffScheduleBody(branchId, entries).asBody()),
        )

    override suspend fun exceptions(query: ScheduleExceptionQuery): List<ScheduleException> =
        client
            .send<ListEnvelope<ScheduleException>>(
                ApiRequest.get(
                    "schedule-exceptions",
                    query =
                        buildList {
                            add("branchId" to query.branchId)
                            query.staffProfileId?.let { add("staffProfileId" to it) }
                            query.from?.let { add("from" to DateTimeFormatter.ISO_INSTANT.format(it)) }
                            query.to?.let { add("to" to DateTimeFormatter.ISO_INSTANT.format(it)) }
                        },
                ),
            ).data

    override suspend fun createException(input: ScheduleExceptionInput): ScheduleException =
        client.send(ApiRequest.post("schedule-exceptions", body = input.toJson().asBody()))

    override suspend fun deleteException(id: String) = client.sendVoid(ApiRequest.delete("schedule-exceptions/$id"))
}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
