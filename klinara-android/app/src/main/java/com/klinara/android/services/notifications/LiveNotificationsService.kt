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

}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
