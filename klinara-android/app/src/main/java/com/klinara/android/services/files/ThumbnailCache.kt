package com.klinara.android.services.files

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.collection.LruCache
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

/**
 * Küçük görsel önbelleği — **YALNIZ BELLEKTE**.
 *
 * Sağlık verisi diskte artakalmamalı (§7.9): bir klinik fotoğrafın küçük hâli de
 * klinik fotoğraftır. `LruCache` süreçle birlikte ölür.
 *
 * **Önbellekte ADRES değil GÖRÜNTÜ duruyor.** İmzalı adres 5 dakikalık; onu saklamak
 * birkaç dakika sonra ölü bağlantı önbelleği tutmak olurdu. Yan fayda daha önemli:
 * ızgara her kaydırmada `download-url` çağırmıyor, dolayısıyla **erişim kaydı
 * kaydırma gürültüsüyle dolmuyor**.
 *
 * **Tam boyut ASLA önbelleğe alınmaz** — her açılış bir `download` kaydı düşürmeli.
 */
class ThumbnailCache(
    private val files: FilesService,
    private val http: OkHttpClient,
) {
    private val cache = LruCache<String, Bitmap>(MAX_ENTRIES)
    private val mutex = Mutex()

    /**
     * Dosyanın küçük görselini getirir; hazır değilse ya da hata olursa `null`.
     *
     * **`409` bir hata değil, "henüz değil" demektir** ve yer tutucuya düşülür; tam
     * boyuta ASLA düşülmez.
     */
    suspend fun thumbnail(file: CustomerFile): Bitmap? {
        if (!file.hasThumbnail) return null
        cache.get(file.id)?.let { return it }

        return mutex.withLock {
            cache.get(file.id) ?: fetch(file.id)?.also { cache.put(file.id, it) }
        }
    }

    private suspend fun fetch(fileId: String): Bitmap? =
        try {
            val address = files.downloadUrl(fileId, FileVariant.Thumb)
            download(address.url)
        } catch (_: ApiError) {
            // 409 (hazır değil), 404, ağ — hepsi yer tutucu demek.
            null
        }

    private fun download(url: String): Bitmap? =
        try {
            http.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (!response.isSuccessful) return null
                response.body.byteStream().use { BitmapFactory.decodeStream(it) }
            }
        } catch (_: IOException) {
            null
        }

    fun clear() = cache.evictAll()

    private companion object {
        /** iOS `countLimit = 200` paritesi. */
        const val MAX_ENTRIES = 200
    }
}
