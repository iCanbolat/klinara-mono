package com.klinara.android.services.networking

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/**
 * Engelleyen OkHttp çağrısını IO havuzunda koşturur ve yanıtı [block] içinde tüketir.
 *
 * **A8.3'te yakalanan gerçek hata:** `ApiClient`, imzalı yükleme ve küçük resim indirme
 * `call.execute()`'u ÇAĞIRANIN dispatcher'ında koşturuyordu — ViewModel'lerde bu `Main`. Canlı
 * modda ilk istek `NetworkOnMainThreadException` ile uygulamayı düşürüyordu; mock mod OkHttp'ye
 * hiç inmediği için emülatör yürüyüşlerinde görünmedi. Gövdeyi okumak da ağ G/Ç'si, bu yüzden
 * [block] de IO'da koşar.
 *
 * Coroutine iptal edilirse çağrı da iptal edilir (`call.cancel()`): engelleyen `execute()`
 * kendiliğinden kesilmez ve gezinmeyle terk edilen bir ekran soketi açık tutardı. İptal OkHttp'de
 * `IOException("Canceled")` olarak yüzeye çıkar; çağıranlar onu `ensureActive()` ile ayırıyor.
 */
internal suspend fun <T> OkHttpClient.executeOffMain(
    request: Request,
    dispatcher: CoroutineDispatcher = Dispatchers.IO,
    block: (Response) -> T,
): T {
    val call = newCall(request)
    return withContext(dispatcher) {
        val cancellation = coroutineContext.job.invokeOnCompletion { cause -> if (cause != null) call.cancel() }
        try {
            call.execute().use(block)
        } finally {
            cancellation.dispose()
        }
    }
}
