package com.klinara.android.services.notifications

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class LiveNotificationsService internal constructor(
    private val client: ApiClient,
) : NotificationsService {
    // Zarf YOK: yanıt doğrudan bir dizi (arama ucuyla aynı istisna).
    override suspend fun optOuts(customerId: String): List<OptOutRecord> =
        client.send(ApiRequest.get("customers/$customerId/opt-out"))

    override suspend fun createOptOut(
        customerId: String,
        channel: NotificationChannel?,
        source: OptOutSource?,
        note: String?,
    ): OptOutRecord =
        client.send(
            ApiRequest.post(
                "customers/$customerId/opt-out",
                body =
                    buildJsonObject {
                        // Kanal GÖNDERİLMEZSE sunucu tüm kanalları kapatır; `null`
                        // yazmakla atlamak burada aynı anlama geliyor ama alanı hiç
                        // koymamak sözleşmeye daha yakın.
                        channel?.takeIf { it != NotificationChannel.Unknown }?.let { put("channel", it.wire) }
                        source?.takeIf { it != OptOutSource.Unknown }?.let { put("source", it.wire) }
                        note?.takeIf { it.isNotBlank() }?.let { put("note", it) }
                    }.asBody(),
            ),
        )

    override suspend fun revokeOptOut(
        customerId: String,
        channel: NotificationChannel?,
    ) = client.sendVoid(
        ApiRequest.delete("customers/$customerId/opt-out")
            .let { request ->
                val query =
                    channel
                        ?.takeIf { it != NotificationChannel.Unknown }
                        ?.let { listOf("channel" to it.wire) }
                        .orEmpty()
                request.copy(query = query)
            },
    )
}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
