package com.klinara.android.services.conversations

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add

/**
 * Resepsiyonun WhatsApp sohbetleri (`/conversations`) — iOS `ConversationsService` paritesi.
 *
 * Kapı `notification:send`: sohbet ekranı müşteriyle yazışmanın kendisi. Gönderim hatası
 * bir HTTP hatası **değildir** — mesaj `status: failed` ve `errorDetail` ile döner.
 */
interface ConversationsService {
    /** `GET conversations` — son mesaja göre yeniden eskiye, cursor'lu. */
    suspend fun conversations(
        filter: ConversationFilter,
        cursor: String? = null,
        limit: Int? = null,
    ): Page<Conversation>

    /** `GET conversations/unread-count` — menü rozeti. */
    suspend fun unreadCount(): Int

    /** `GET conversations/:id` — sohbet ve son 200 mesaj. */
    suspend fun conversation(id: String): ConversationDetail

    /** `POST conversations/:id/messages` — pencere kapalıysa `422 WHATSAPP_WINDOW_CLOSED`. */
    suspend fun send(
        conversationId: String,
        body: String,
    ): ConversationMessage

    /** `GET conversations/:id/templates` — onaylı, butonsuz şablonlar; önerilerle. */
    suspend fun templateOptions(conversationId: String): List<ConversationTemplateOption>

    /** `POST conversations/:id/template` — pencereden bağımsız. */
    suspend fun sendTemplate(
        conversationId: String,
        templateName: String,
        language: String,
        parameters: List<String>,
    ): ConversationMessage

    /** `POST conversations/:id/read` — 204. */
    suspend fun markRead(conversationId: String)

    /** `POST conversations/:id/close|reopen`. */
    suspend fun setClosed(
        conversationId: String,
        closed: Boolean,
    ): Conversation

    /** `PUT conversations/:id/customer` — ayrıca `customer:read` ister. */
    suspend fun linkCustomer(
        conversationId: String,
        customerId: String,
    ): Conversation
}

class LiveConversationsService internal constructor(
    private val client: ApiClient,
) : ConversationsService {
    override suspend fun conversations(
        filter: ConversationFilter,
        cursor: String?,
        limit: Int?,
    ): Page<Conversation> =
        client.send(
            ApiRequest.get(
                PATH,
                query =
                    buildList {
                        addAll(filter.query)
                        cursor?.let { add("cursor" to it) }
                        limit?.let { add("limit" to it.toString()) }
                    },
            ),
        )

    override suspend fun unreadCount(): Int =
        client.send<UnreadConversationCount>(ApiRequest.get("$PATH/unread-count")).count

    override suspend fun conversation(id: String): ConversationDetail = client.send(ApiRequest.get("$PATH/$id"))

    override suspend fun send(
        conversationId: String,
        body: String,
    ): ConversationMessage =
        client.send(
            ApiRequest.post("$PATH/$conversationId/messages", body = buildJsonObject { put("body", body) }.asBody()),
        )

    override suspend fun templateOptions(conversationId: String): List<ConversationTemplateOption> =
        client.send(ApiRequest.get("$PATH/$conversationId/templates"))

    override suspend fun sendTemplate(
        conversationId: String,
        templateName: String,
        language: String,
        parameters: List<String>,
    ): ConversationMessage =
        client.send(
            ApiRequest.post(
                "$PATH/$conversationId/template",
                body =
                    buildJsonObject {
                        put("templateName", templateName)
                        put("language", language)
                        putJsonArray("parameters") { parameters.forEach { add(it) } }
                    }.asBody(),
            ),
        )

    override suspend fun markRead(conversationId: String) =
        client.sendVoid(ApiRequest.post("$PATH/$conversationId/read"))

    override suspend fun setClosed(
        conversationId: String,
        closed: Boolean,
    ): Conversation = client.send(ApiRequest.post("$PATH/$conversationId/${if (closed) "close" else "reopen"}"))

    override suspend fun linkCustomer(
        conversationId: String,
        customerId: String,
    ): Conversation =
        client.send(
            ApiRequest.put(
                "$PATH/$conversationId/customer",
                body = buildJsonObject { put("customerId", customerId) }.asBody(),
            ),
        )

    private companion object {
        const val PATH = "conversations"
    }
}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
