package com.klinara.android.services.realtime

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.ApiRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/**
 * Anlık olay soketi — uygulama öndeyken açık, arka plana geçince kapalı.
 *
 * Push bu işin aracı değil: teslimi garanti değil ve uygulama zaten açıkken gereksiz.
 * Soket kopuksa hiçbir şey bozulmaz; ekranlar kendi yüklemeleri ve öne dönüşte
 * tazelemeyle çalışır.
 *
 * Kimlik: önce `POST realtime/ticket` ile kısa ömürlü bilet, sonra bağlandıktan
 * sonraki İLK mesajda gönderim. Bilet URL'de taşınmaz (erişim loglarına düşmesin);
 * soket [bareHttp] ile açılır — oturum bearer'ı el sıkışmaya hiç girmez.
 *
 * `start()` sonrasındaki İLK bağlantı [RealtimeEvent.Resync] yaymaz: çağıran o an
 * zaten tazeliyor. Aynı oturumdaki yeniden bağlanmalar yayar.
 */
class RealtimeClient internal constructor(
    private val api: ApiClient,
    bareHttp: OkHttpClient,
    private val socketUrl: HttpUrl,
    private val scope: CoroutineScope,
) {
    private val http =
        bareHttp
            .newBuilder()
            // Okuma zaman aşımı yok: soket olay gelene kadar sessiz bekler. Canlılığı
            // sunucunun ping'i ve buradaki ping aralığı denetler.
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(PING_SECONDS, TimeUnit.SECONDS)
            .build()

    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 16)
    val events: SharedFlow<RealtimeEvent> = _events.asSharedFlow()

    private var loop: Job? = null

    @Synchronized
    fun start() {
        if (loop?.isActive == true) return
        loop = scope.launch { run() }
    }

    @Synchronized
    fun stop() {
        loop?.cancel()
        loop = null
    }

    private suspend fun run() {
        var retryMillis = RETRY_MIN_MS
        var connectedBefore = false
        while (scope.isActive) {
            when (val outcome = connectOnce(announceResync = connectedBefore)) {
                Outcome.Stopped -> return
                is Outcome.Dropped ->
                    if (outcome.wasReady) {
                        connectedBefore = true
                        retryMillis = RETRY_MIN_MS
                    }
            }
            // Sunucu yeniden başladığında tüm cihazlar aynı anda dönmesin.
            delay((retryMillis * Random.nextDouble(JITTER_MIN, JITTER_MAX)).toLong())
            retryMillis = (retryMillis * 2).coerceAtMost(RETRY_MAX_MS)
        }
    }

    private sealed interface Outcome {
        /** Kalıcı ret (oturum ya da yetki yok) — bir sonraki `start()`a kadar dur. */
        data object Stopped : Outcome

        data class Dropped(
            val wasReady: Boolean,
        ) : Outcome
    }

    private sealed interface Signal {
        data class Text(
            val text: String,
        ) : Signal

        data class Closed(
            val code: Int,
        ) : Signal
    }

    @Suppress("ReturnCount")
    private suspend fun connectOnce(announceResync: Boolean): Outcome {
        val ticket =
            try {
                api.send<Ticket>(ApiRequest.post("realtime/ticket")).ticket
            } catch (error: ApiError) {
                return if (error.isAuthFailure()) Outcome.Stopped else Outcome.Dropped(wasReady = false)
            }

        val signals = Channel<Signal>(Channel.UNLIMITED)
        val socket =
            http.newWebSocket(
                Request.Builder().url(socketUrl).build(),
                object : WebSocketListener() {
                    override fun onOpen(
                        webSocket: WebSocket,
                        response: Response,
                    ) {
                        webSocket.send("""{"type":"auth","ticket":"$ticket"}""")
                    }

                    override fun onMessage(
                        webSocket: WebSocket,
                        text: String,
                    ) {
                        signals.trySend(Signal.Text(text))
                    }

                    override fun onClosing(
                        webSocket: WebSocket,
                        code: Int,
                        reason: String,
                    ) {
                        webSocket.close(code, null)
                        signals.trySend(Signal.Closed(code))
                    }

                    override fun onFailure(
                        webSocket: WebSocket,
                        t: Throwable,
                        response: Response?,
                    ) {
                        signals.trySend(Signal.Closed(0))
                    }
                },
            )

        return try {
            readUntilClosed(signals, announceResync)
        } finally {
            socket.cancel()
        }
    }

    private suspend fun readUntilClosed(
        signals: Channel<Signal>,
        announceResync: Boolean,
    ): Outcome {
        var ready = false
        for (signal in signals) {
            when (signal) {
                is Signal.Closed ->
                    return if (signal.code in FATAL_CLOSE_CODES) Outcome.Stopped else Outcome.Dropped(ready)
                is Signal.Text -> ready = dispatch(signal.text, announceResync) || ready
            }
        }
        return Outcome.Dropped(ready)
    }

    /** Çerçeveyi yayınlar; `true` → sunucu kimliği kabul etti (`ready`). */
    private fun dispatch(
        text: String,
        announceResync: Boolean,
    ): Boolean =
        when (val frame = RealtimeFrame.decode(text)) {
            RealtimeFrame.Ready -> {
                if (announceResync) _events.tryEmit(RealtimeEvent.Resync)
                true
            }
            is RealtimeFrame.Event -> {
                _events.tryEmit(frame.event)
                false
            }
            null -> false
        }

    private fun ApiError.isAuthFailure(): Boolean =
        this is ApiError.Problem && (problem.status == HTTP_UNAUTHORIZED || problem.status == HTTP_FORBIDDEN)

    @Serializable
    private data class Ticket(
        val ticket: String,
    )

    companion object {
        private const val PING_SECONDS = 25L
        private const val RETRY_MIN_MS = 1_000L
        private const val RETRY_MAX_MS = 30_000L
        private const val JITTER_MIN = 0.5
        private const val JITTER_MAX = 1.5
        private const val HTTP_UNAUTHORIZED = 401
        private const val HTTP_FORBIDDEN = 403

        /** Sunucunun kimlik/yetki reddi — yeniden denemek aynı cevabı alır. */
        private val FATAL_CLOSE_CODES = setOf(4401, 4403)

        /** `https://…/api/v1/` → `wss://…/api/v1/realtime` (OkHttp `ws(s)`yi `http(s)` olarak taşır). */
        fun socketUrl(baseUrl: HttpUrl): HttpUrl = baseUrl.newBuilder().addPathSegment("realtime").build()
    }
}
