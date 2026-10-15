package com.klinara.android.services.push

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Bu oturumun FCM anahtarı — `PUT/DELETE push-devices/current`.
 *
 * Kayıt sunucuda OTURUMA bağlı: çıkış yapılınca ya da oturum iptal edilince cihaza
 * bildirim gitmez. Çıkışta yine de silinir ki satır beklemesin. iOS paritesi.
 */
interface PushService {
    suspend fun register(token: String)

    suspend fun unregister()
}

class LivePushService internal constructor(
    private val client: ApiClient,
) : PushService {
    override suspend fun register(token: String) =
        client.sendVoid(
            ApiRequest.put(
                "push-devices/current",
                body =
                    buildJsonObject {
                        put("platform", "android")
                        put("token", token)
                    }.asBody(),
            ),
        )

    override suspend fun unregister() = client.sendVoid(ApiRequest.delete("push-devices/current"))
}

/** Sunucusuz kurulum: kayıt hiçbir yere gitmez. */
class MockPushService : PushService {
    override suspend fun register(token: String) = Unit

    override suspend fun unregister() = Unit
}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
