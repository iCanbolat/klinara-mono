package com.klinara.android.services.networking

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/**
 * Ön imzalı URL'ye doğrudan yükleme.
 *
 * **Yalnız `Content-Type` gönderilir.** `Authorization`, `X-Branch-Id`, `X-Request-Id`
 * ve `Accept` YOKTUR: imza zaten yetkidir ve oturum token'ı nesne depolamasına
 * sızmamalıdır. Bu, bir hata değil bir güvenlik olayı olurdu; o yüzden burada tag'e
 * güvenilmez, hiç interceptor'ı olmayan ayrı bir istemci (`bareHttp`) kullanılır ve
 * onu kurucu üzerinden alan tek sınıf budur — sızıntı yapısal olarak imkânsız.
 *
 * 401'de yenileme DENENMEZ: süresi dolan bir imza yeni bir `presign` ister, yeni bir
 * access token değil.
 */
class SignedUploader internal constructor(
    private val bareHttp: OkHttpClient,
) {
    suspend fun upload(
        url: String,
        data: ByteArray,
        contentType: String,
    ) {
        // Content-Type presign yanıtıyla BAYT BAYT aynı olmalı, yoksa imza tutmaz.
        val request =
            Request
                .Builder()
                .url(url)
                .put(data.toRequestBody(contentType.toMediaType()))
                .build()

        val response =
            try {
                bareHttp.newCall(request).execute()
            } catch (e: IOException) {
                currentCoroutineContext().ensureActive()
                throw ApiError.Network(e)
            }

        response.use {
            if (!it.isSuccessful) throw ApiError.UploadFailed(it.code)
        }
    }
}
