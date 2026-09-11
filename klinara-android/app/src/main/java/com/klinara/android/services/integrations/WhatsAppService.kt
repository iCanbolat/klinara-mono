package com.klinara.android.services.integrations

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest

/**
 * WhatsApp entegrasyonu ve gelen kutusu — iOS `WhatsAppService` paritesi.
 *
 * **Gelen kutusu burada**, bildirim servisinde değil: gelen mesajlar webhook'tan
 * (`integrations` modülü) düşüyor ve sunucuda da oradalar. A8.1 yalnız gelen kutusu
 * dilimini getiriyor; hesap, doğrulama ve test gönderimi A8.3'te bu arayüzün üstüne biner.
 *
 * İzinler: okuma `notification:read`, "işlendi" `notification:send`.
 */
interface WhatsAppService {
    /**
     * `GET inbox?onlyUnhandled=&limit=` — **çıplak dizi**, sayfalama YOK (sunucu cursor vermiyor).
     *
     * [onlyUnhandled] her zaman gönderilir: sunucu `"false"` dışındaki her şeyi `true` sayıyor
     * ve parametreyi atlamak "yalnız işlenmemişler" demek olurdu.
     */
    suspend fun inbox(
        onlyUnhandled: Boolean,
        limit: Int? = null,
    ): List<InboxItem>

    /** `POST inbox/:id/handle` — 204, gövdesiz. */
    suspend fun markInboxHandled(id: String)
}

class LiveWhatsAppService internal constructor(
    private val client: ApiClient,
) : WhatsAppService {
    override suspend fun inbox(
        onlyUnhandled: Boolean,
        limit: Int?,
    ): List<InboxItem> =
        client.send(
            ApiRequest.get(
                "inbox",
                query =
                    buildList {
                        add("onlyUnhandled" to onlyUnhandled.toString())
                        limit?.let { add("limit" to it.toString()) }
                    },
            ),
        )

    override suspend fun markInboxHandled(id: String) = client.sendVoid(ApiRequest.post("inbox/$id/handle"))
}
