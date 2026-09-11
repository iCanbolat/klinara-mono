package com.klinara.android.services.notifications

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.Page
import java.time.format.DateTimeFormatter

/**
 * Mesaj günlüğü (A8.1) — iOS `MessagesService` paritesi.
 *
 * Tek uçlu ayrı bir sözleşme olmasının sebebi iOS'takiyle aynı: günlük salt okuma bir
 * teşhis aracı ve `notification:read` ile açılır; şablon yazma metotlarını taşıyan
 * [NotificationsService] ile birleştirmek, okuyabilen her role yazma yüzeyini de göstermek olurdu.
 */
interface MessagesService {
    /**
     * `GET messages` — cursor sayfalamalı (`{ data, pageInfo }`), en yeni önce.
     *
     * [limit] 1–200; verilmezse sunucu 50 kullanır. [cursor] opak — istemci onu **üretmez**,
     * yalnız taşır.
     */
    suspend fun messages(
        cursor: String? = null,
        limit: Int? = null,
        filter: MessageFilter = MessageFilter.NONE,
    ): Page<Message>
}

class LiveMessagesService internal constructor(
    private val client: ApiClient,
) : MessagesService {
    override suspend fun messages(
        cursor: String?,
        limit: Int?,
        filter: MessageFilter,
    ): Page<Message> =
        client.send(
            ApiRequest.get(
                "messages",
                query =
                    buildList {
                        // Yalnız dolu alanlar: boş bir `status=` sunucuda doğrulama hatasıdır.
                        cursor?.let { add("cursor" to it) }
                        limit?.let { add("limit" to it.toString()) }
                        filter.customerId?.let { add("customerId" to it) }
                        filter.channel?.takeIf { it != NotificationChannel.Unknown }?.let { add("channel" to it.wire) }
                        filter.event?.takeIf { it != NotificationEvent.Unknown }?.let { add("event" to it.wire) }
                        filter.status?.takeIf { it != MessageStatus.Unknown }?.let { add("status" to it.wire) }
                        filter.from?.let { add("from" to DateTimeFormatter.ISO_INSTANT.format(it)) }
                        filter.to?.let { add("to" to DateTimeFormatter.ISO_INSTANT.format(it)) }
                    },
            ),
        )
}
