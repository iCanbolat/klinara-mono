package com.klinara.android.services.integrations

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * WhatsApp entegrasyonu ve gelen kutusu — iOS `WhatsAppService` paritesi.
 *
 * **Gelen kutusu burada**, bildirim servisinde değil: gelen mesajlar webhook'tan
 * (`integrations` modülü) düşüyor ve sunucuda da oradalar. Gelen kutusu A8.1'de, hesap,
 * doğrulama ve test gönderimi A8.3'te geldi.
 *
 * İzinler: hesap `notification:manage`, şablon listesi `notification:read`, test gönderimi
 * ve "işlendi" `notification:send`.
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

    /**
     * `GET integrations/whatsapp` — kurulmamışken **boş gövdeli 200** (`sendOptional`). `null` bir
     * hata değil, "henüz kurulmadı" demek; ekran boş durumu gösterir, kırmızı bant değil.
     */
    suspend fun account(): WhatsAppAccount?

    /** `PUT integrations/whatsapp` — kaydetmek hesabı DOĞRULANMAMIŞ duruma düşürür. */
    suspend fun upsertAccount(input: WhatsAppAccountUpsert): WhatsAppAccount

    /** `POST integrations/whatsapp/verify` — Meta'ya karşı sınar, şablonları senkronlar. */
    suspend fun verify(): WhatsAppVerifyResult

    /** `GET integrations/whatsapp/templates` — çıplak dizi, son senkronun bıraktığı satırlar. */
    suspend fun templates(): List<WhatsAppTemplate>

    /** `POST integrations/whatsapp/test` — kalıcı hata 422, geçici (kota) 503. */
    suspend fun sendTest(input: WhatsAppTestSend): WhatsAppTestResult
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

    override suspend fun account(): WhatsAppAccount? = client.sendOptional(ApiRequest.get(ACCOUNT_PATH))

    override suspend fun upsertAccount(input: WhatsAppAccountUpsert): WhatsAppAccount =
        client.send(
            ApiRequest.put(
                ACCOUNT_PATH,
                body =
                    buildJsonObject {
                        put("wabaId", input.wabaId)
                        put("phoneNumberId", input.phoneNumberId)
                        input.businessPhone?.let { put("businessPhone", it) }
                        put("accessToken", input.accessToken)
                        // `null` YAZILMAZ: alan yoksa sunucu kayıtlı secret'ı korur ([S] A8.3); `null`
                        // değeri `encrypt(null)`'a gidip patlardı.
                        input.appSecret?.let { put("appSecret", it) }
                        input.apiVersion?.let { put("apiVersion", it) }
                    }.asBody(),
            ),
        )

    override suspend fun verify(): WhatsAppVerifyResult = client.send(ApiRequest.post("$ACCOUNT_PATH/verify"))

    override suspend fun templates(): List<WhatsAppTemplate> = client.send(ApiRequest.get("$ACCOUNT_PATH/templates"))

    override suspend fun sendTest(input: WhatsAppTestSend): WhatsAppTestResult =
        client.send(
            ApiRequest.post(
                "$ACCOUNT_PATH/test",
                body =
                    buildJsonObject {
                        put("to", input.to)
                        put("templateName", input.templateName)
                        put("templateLanguage", input.templateLanguage)
                    }.asBody(),
            ),
        )

    private companion object {
        const val ACCOUNT_PATH = "integrations/whatsapp"
    }
}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
