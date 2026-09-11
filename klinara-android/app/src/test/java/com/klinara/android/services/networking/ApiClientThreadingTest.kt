package com.klinara.android.services.networking

import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.util.concurrent.Executors

/**
 * A8.3'te canlı modda yakalanan hata: `call.execute()` çağıranın dispatcher'ında (ViewModel'lerde
 * `Main`) koşuyordu ve ilk istek `NetworkOnMainThreadException` ile uygulamayı düşürüyordu.
 * JVM'de StrictMode yok; bu yüzden ağ işini yapan iş parçacığının ÇAĞIRANINKİ OLMADIĞI ölçülüyor.
 */
class ApiClientThreadingTest {
    private lateinit var server: MockWebServer

    @BeforeEach
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @AfterEach
    fun tearDown() = server.close()

    @Serializable
    private data class Pong(
        val ok: Boolean,
    )

    @Test
    @DisplayName("Ağ çağrısı çağıranın (Main benzeri tek) iş parçacığında KOŞMAZ")
    fun networkRunsOffCallerThread() {
        server.enqueue(MockResponse.Builder().code(200).body("""{"ok":true}""").build())
        var networkThread: Thread? = null
        val http =
            OkHttpClient
                .Builder()
                .addInterceptor { chain ->
                    networkThread = Thread.currentThread()
                    chain.proceed(chain.request())
                }.build()
        val client = ApiClient(http, server.url("/api/v1/"))
        val main = Executors.newSingleThreadExecutor { Thread(it, "fake-main") }

        val pong =
            runBlocking {
                withContext(main.asCoroutineDispatcher()) {
                    client.send<Pong>(ApiRequest.get("ping", requiresAuth = false))
                }
            }
        main.shutdown()

        assertEquals(true, pong.ok)
        assertNotEquals("fake-main", networkThread?.name)
    }
}
