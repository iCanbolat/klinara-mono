package com.klinara.android.services.crm

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class LiveNotesService internal constructor(
    private val client: ApiClient,
) : NotesService {
    override suspend fun notes(customerId: String): List<CustomerNote> {
        val envelope: ListEnvelope<CustomerNote> = client.send(ApiRequest.get("customers/$customerId/notes"))
        return envelope.data
    }

    override suspend fun create(
        customerId: String,
        body: String,
        kind: CustomerNoteKind,
        appointmentId: String?,
        customerVisible: Boolean,
    ): CustomerNote =
        client.send(
            ApiRequest.post(
                "customers/$customerId/notes",
                body =
                    buildJsonObject {
                        put("body", body)
                        put("kind", kind.wire)
                        put("customerVisible", customerVisible)
                        appointmentId?.let { put("appointmentId", it) }
                    }.asBody(),
            ),
        )

    override suspend fun update(
        id: String,
        version: Int,
        body: String?,
        kind: CustomerNoteKind?,
        customerVisible: Boolean?,
    ): CustomerNote =
        client.send(
            ApiRequest.patch(
                "notes/$id",
                body =
                    buildJsonObject {
                        body?.let { put("body", it) }
                        kind?.let { put("kind", it.wire) }
                        customerVisible?.let { put("customerVisible", it) }
                    }.asBody(),
                // Boş yama da sürümü DOĞRULUYOR: "hiçbir şey değiştirme" isteği bile
                // bayat bir sürümle geldiyse istemcinin elindeki kopya yanlıştır.
                ifMatch = ApiRequest.weakETag(version),
            ),
        )

    // `If-Match` YOK ve bu bilinçli: kilidin koruduğu şey notun metni ve revizyon
    // geçmişi; arşivleme geri alınabilir bir soft delete.
    override suspend fun delete(id: String) = client.sendVoid(ApiRequest.delete("notes/$id"))

    override suspend fun revisions(noteId: String): List<CustomerNoteRevision> {
        val envelope: ListEnvelope<CustomerNoteRevision> =
            client.send(ApiRequest.get("notes/$noteId/revisions"))
        return envelope.data
    }

    override suspend fun timeline(
        customerId: String,
        query: TimelineQuery,
    ): Page<TimelineEntry> =
        client.send(
            ApiRequest.get(
                "customers/$customerId/timeline",
                query =
                    buildList {
                        query.limit?.let { add("limit" to it.toString()) }
                        query.cursor?.let { add("cursor" to it) }
                        // Virgülle birleştirilmiş TEK değer, sabit sırada. Boş küme
                        // gönderilmez: `?kinds=` yazmak "hiçbiri" anlamına gelmiyor ama
                        // göndermemek daha açık.
                        query.kinds
                            .takeIf { it.isNotEmpty() }
                            ?.let { kinds ->
                                val wire =
                                    TimelineKind.selectable
                                        .filter { it in kinds }
                                        .joinToString(",") { it.wire }
                                add("kinds" to wire)
                            }
                    },
            ),
        )
}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
