package com.klinara.android.services.notifications

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class LiveNotificationsService internal constructor(
    private val client: ApiClient,
) : NotificationsService {
    override suspend fun appointmentNotifications(appointmentId: String): List<ScheduledNotification> =
        client.send(ApiRequest.get("appointments/$appointmentId/notifications"))

    override suspend fun templates(): List<NotificationTemplate> =
        client.send(ApiRequest.get("notification-templates"))

    override suspend fun upsertTemplate(input: NotificationTemplateUpsert): NotificationTemplate =
        client.send(
            ApiRequest.put(
                "notification-templates",
                body =
                    buildJsonObject {
                        put("event", input.event.wire)
                        put("channel", input.channel.wire)
                        put("locale", input.locale)
                        // Konu anahtarı e-posta dışında HİÇ yazılmamalı: sunucu `null` değeri de
                        // "konu verilmiş" sayıp 422 döndürüyor (`subject !== undefined`).
                        input.subject?.let { put("subject", it) }
                        put("body", input.body)
                        input.whatsappTemplateName?.let { put("whatsappTemplateName", it) }
                        input.whatsappTemplateLanguage?.let { put("whatsappTemplateLanguage", it) }
                        input.whatsappVariables?.let { names ->
                            put("whatsappVariables", JsonArray(names.map(::JsonPrimitive)))
                        }
                        put("isActive", input.isActive)
                    }.asBody(),
            ),
        )

    override suspend fun preferences(): List<NotificationPreference> =
        client.send(ApiRequest.get("notification-preferences"))

    override suspend fun upsertPreference(input: NotificationPreferenceUpsert): NotificationPreference =
        client.send(
            ApiRequest.put(
                "notification-preferences",
                body =
                    buildJsonObject {
                        input.branchId?.let { put("branchId", it) }
                        put("event", input.event.wire)
                        put(
                            "channels",
                            JsonArray(
                                input.channels
                                    .filter { it != NotificationChannel.Unknown }
                                    .map { JsonPrimitive(it.wire) },
                            ),
                        )
                        // İki uç HER ZAMAN birlikte: sunucu yalnız birini alınca 422 veriyor.
                        put("quietHoursStart", input.quietHoursStart.wireValue)
                        put("quietHoursEnd", input.quietHoursEnd.wireValue)
                    }.asBody(),
            ),
        )

    override suspend fun reminderSettings(branchId: String): BranchReminderSettings =
        client.send(ApiRequest.get("branches/$branchId/reminder-settings"))

    override suspend fun updateReminderSettings(
        branchId: String,
        update: ReminderSettingsUpdate,
    ): BranchReminderSettings =
        client.send(
            ApiRequest.put(
                "branches/$branchId/reminder-settings",
                body =
                    buildJsonObject {
                        // Yalnız değişen alanlar: saat listesini her kayıtta göndermek, kiracı
                        // varsayılanını kullanan şubeye KAZARA override yazıyordu (iOS hatası).
                        update.reminderHoursBefore?.let { hours ->
                            put("reminderHoursBefore", JsonArray(hours.map(::JsonPrimitive)))
                        }
                        update.noShowFollowupEnabled?.let { put("noShowFollowupEnabled", it) }
                        update.noShowFollowupDelayHours?.let { put("noShowFollowupDelayHours", it) }
                    }.asBody(),
            ),
        )

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
