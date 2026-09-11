package com.klinara.android.services.networking

import com.klinara.android.services.auth.TokenStore
import com.klinara.android.services.contracts.ApiErrorCode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.HttpUrl
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@Serializable
private data class Ping(val ok: Boolean, val name: String? = null)

@Serializable
private data class Body(val value: String, val optional: String? = null)

/**
 * A0.4'ün sözleşme testleri. Hepsi `MockWebServer` üzerinde koşar — sunucusuz,
 * cihazsız, hızlı.
 *
 * Buradaki iddiaların çoğu bir şeyin VARLIĞINI değil YOKLUĞUNU doğruluyor
 * (imzalı yüklemede `Authorization` yok, `bearerOverride`'da `X-Branch-Id` yok,
 * ikinci bir yenileme yok). Sızıntılar tam olarak orada oluyor.
 */
class ApiClientTest {
    private lateinit var server: MockWebServer
    private lateinit var scope: CoroutineScope
    private lateinit var tokens: TokenStore
    private var expiredCount = 0

    private lateinit var client: ApiClient
    private lateinit var uploader: SignedUploader

    private val baseUrl: HttpUrl get() = server.url("/api/v1/")

    @BeforeEach
    fun setUp() {
        server = MockWebServer()
        server.start()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        tokens = testTokenStore()
        expiredCount = 0

        val clients =
            OkHttpFactory.create(
                tokens = tokens,
                scope = scope,
                onExpired = { expiredCount++ },
                baseUrl = baseUrl,
            )
        client = ApiClient(clients.api, baseUrl)
        uploader = SignedUploader(clients.bare)
    }

    @AfterEach
    fun tearDown() {
        scope.cancel()
        server.close()
    }

    private suspend fun signIn(access: String = "access-1") {
        tokens.save(tokens(access))
        tokens.setBranch("branch-nisantasi")
        tokens.warmUp()
    }

    private fun json(
        body: String,
        code: Int = 200,
    ) = MockResponse.Builder()
        .code(code)
        .setHeader("Content-Type", "application/json")
        .body(body)
        .build()

    // ---------------------------------------------------------------- hatalar

    @Test
    @DisplayName("problem+json çözülür ve alan hataları haritalanır")
    fun decodesProblemJsonWithFieldErrors() =
        runTest {
            server.enqueue(
                json(
                    problemJson(
                        code = "VALIDATION_FAILED",
                        status = 400,
                        errors = """[{"path":"email","message":"Geçersiz e-posta"},
                                     {"path":"email","message":"İkinci mesaj"}]""",
                    ),
                    code = 400,
                ),
            )

            val error =
                assertThrows(ApiError.Problem::class.java) {
                    kotlinx.coroutines.runBlocking { client.send<Ping>(ApiRequest.get("ping", requiresAuth = false)) }
                }

            assertEquals(ApiErrorCode.VALIDATION_FAILED, error.code)
            assertEquals(400, error.status)
            // Alan başına İLK mesaj alınır; ikisini birden göstermek gürültü olurdu.
            assertEquals(mapOf("email" to "Geçersiz e-posta"), error.fieldErrors)
            assertTrue(error.isFieldScoped, "Alan bazlı hata ekran afişi göstermemeli")
        }

    @Test
    @DisplayName("Tanınmayan hata kodu UNKNOWN'a düşer, çözümlemeyi kırmaz")
    fun unknownErrorCodeFallsBack() =
        runTest {
            server.enqueue(json(problemJson("YEPYENI_BIR_KOD", 400), code = 400))

            val error =
                assertThrows(ApiError.Problem::class.java) {
                    kotlinx.coroutines.runBlocking { client.send<Ping>(ApiRequest.get("ping", requiresAuth = false)) }
                }
            assertEquals(ApiErrorCode.UNKNOWN, error.code)
        }

    @Test
    @DisplayName("JSON olmayan gövde: 502 INTERNAL_ERROR, 418 UNKNOWN olarak sentezlenir")
    fun synthesisesProblemForNonJsonBodies() =
        runTest {
            server.enqueue(MockResponse.Builder().code(502).body("<html>bad gateway</html>").build())
            val serverError =
                assertThrows(ApiError.Problem::class.java) {
                    kotlinx.coroutines.runBlocking { client.send<Ping>(ApiRequest.get("a", requiresAuth = false)) }
                }
            assertEquals(ApiErrorCode.INTERNAL_ERROR, serverError.code)
            assertEquals(502, serverError.status)

            server.enqueue(MockResponse.Builder().code(418).body("teapot").build())
            val oddError =
                assertThrows(ApiError.Problem::class.java) {
                    kotlinx.coroutines.runBlocking { client.send<Ping>(ApiRequest.get("b", requiresAuth = false)) }
                }
            assertEquals(ApiErrorCode.UNKNOWN, oddError.code)
            assertEquals(418, oddError.status)
        }

    @Test
    @DisplayName("FORBIDDEN oturumu DÜŞÜRMEZ, token hataları düşürür")
    fun onlyTokenErrorsInvalidateSession() =
        runTest {
            val forbidden = ApiError.Problem(ProblemDetails(ApiErrorCode.FORBIDDEN, status = 403))
            val expired = ApiError.Problem(ProblemDetails(ApiErrorCode.TOKEN_EXPIRED, status = 401))
            assertFalse(forbidden.invalidatesSession, "Yetkisizlik kullanıcıyı çıkışa atmamalı")
            assertTrue(expired.invalidatesSession)
        }

    // -------------------------------------------------------------- başlıklar

    @Test
    @DisplayName("Yetkili GET tüm kimlik başlıklarını taşır, gövdesizken Content-Type taşımaz")
    fun authorisedGetCarriesExpectedHeaders() =
        runTest {
            signIn()
            server.enqueue(json("""{"ok":true}"""))
            server.enqueue(json("""{"ok":true}"""))

            client.send<Ping>(ApiRequest.get("me"))
            client.send<Ping>(ApiRequest.get("me"))

            val first = server.takeRequest()
            val second = server.takeRequest()

            assertEquals("application/json", first.headers["Accept"])
            assertEquals("Bearer access-1", first.headers["Authorization"])
            assertEquals("branch-nisantasi", first.headers["X-Branch-Id"])
            assertNull(first.headers["Content-Type"], "Gövdesiz istekte Content-Type olmamalı")

            val firstId = first.headers["X-Request-Id"]
            val secondId = second.headers["X-Request-Id"]
            assertTrue(!firstId.isNullOrBlank())
            assertNotEquals(firstId, secondId, "Her istek kendi X-Request-Id'sini taşımalı")
        }

    @Test
    @DisplayName("requiresAuth=false: ne Authorization ne X-Branch-Id")
    fun anonymousRequestCarriesNoIdentity() =
        runTest {
            signIn()
            server.enqueue(json("""{"ok":true}"""))

            client.send<Ping>(ApiRequest.get("auth/passkey/options", requiresAuth = false))

            val request = server.takeRequest()
            assertNull(request.headers["Authorization"])
            assertNull(request.headers["X-Branch-Id"])
        }

    @Test
    @DisplayName("bearerOverride: ara token gider, X-Branch-Id GİTMEZ")
    fun bearerOverrideOmitsBranchScope() =
        runTest {
            signIn()
            server.enqueue(json("""{"ok":true}"""))

            client.send<Ping>(
                ApiRequest.post("auth/2fa/setup", requiresAuth = false, bearerOverride = "mfa.token"),
            )

            val request = server.takeRequest()
            assertEquals("Bearer mfa.token", request.headers["Authorization"])
            assertNull(
                request.headers["X-Branch-Id"],
                "mfa ara token'ının şube kapsamı yok; gönderilirse sunucu 400 verir",
            )
        }

    @Test
    @DisplayName("Gövdeli POST: Content-Type var, null alanlar atlanır")
    fun postSendsJsonAndOmitsNulls() =
        runTest {
            signIn()
            server.enqueue(json("""{"ok":true}"""))

            val payload = RequestBodyPayload(KlinaraJson.encodeToString(Body(value = "x")))
            client.send<Ping>(ApiRequest.post("things", body = payload))

            val request = server.takeRequest()
            assertTrue(request.headers["Content-Type"]!!.startsWith("application/json"))
            val sent = request.body!!.utf8()
            assertTrue(sent.contains("\"value\":\"x\""))
            assertFalse(sent.contains("optional"), "explicitNulls=false null alanları atlamalı")
        }

    @Test
    @DisplayName("Idempotency-Key ve If-Match bayt bayt geçer")
    fun passesThroughConcurrencyHeaders() =
        runTest {
            signIn()
            server.enqueue(json("""{"ok":true}"""))

            client.send<Ping>(
                ApiRequest.post(
                    "appointments",
                    idempotencyKey = "idem-123",
                    ifMatch = ApiRequest.weakETag(3),
                ),
            )

            val request = server.takeRequest()
            assertEquals("idem-123", request.headers["Idempotency-Key"])
            assertEquals("""W/"3"""", request.headers["If-Match"])
        }

    // --------------------------------------------------- tek uçuşlu yenileme

    @Test
    @DisplayName("Eş zamanlı üç 401 TEK bir /auth/refresh tetikler")
    fun concurrentUnauthorisedRequestsRefreshOnce() =
        runTest {
            signIn(access = "stale")

            // Sıralı kuyruk (`enqueue`) KULLANILMAZ: MockWebServer yanıtları isteklerin
            // VARIŞ sırasına göre dağıtır. Yük altında ilk 401'in yenilemesi üçüncü GET'ten
            // önce varırsa kuyruktaki üçüncü 401'i yenileme alır, oturum düşer ve test
            // yanlış sebeple kırılır. Yanıt, isteğin NE olduğuna göre seçilir.
            //
            // Bayat istekler üçü de gelene kadar bekletilir: üç 401'in gerçekten eş zamanlı
            // olduğu şansa değil bu bariyere dayanır.
            val staleBarrier = java.util.concurrent.CountDownLatch(3)
            val barrierMet = java.util.concurrent.atomic.AtomicInteger()
            server.dispatcher =
                object : mockwebserver3.Dispatcher() {
                    override fun dispatch(request: mockwebserver3.RecordedRequest): MockResponse =
                        when {
                            request.url.encodedPath.endsWith("/auth/refresh") ->
                                json("""{"accessToken":"fresh","refreshToken":"r2","expiresIn":900}""")

                            request.headers["Authorization"] == "Bearer stale" -> {
                                staleBarrier.countDown()
                                if (staleBarrier.await(5, java.util.concurrent.TimeUnit.SECONDS)) {
                                    barrierMet.incrementAndGet()
                                }
                                json(problemJson("TOKEN_EXPIRED", 401), code = 401)
                            }

                            request.headers["Authorization"] == "Bearer fresh" -> json("""{"ok":true}""")

                            else -> json(problemJson("UNEXPECTED_REQUEST", 400), code = 400)
                        }
                }

            val results =
                listOf("a", "b", "c").map { path ->
                    scope.async { client.send<Ping>(ApiRequest.get(path)) }
                }.awaitAll()

            assertTrue(results.all { it.ok })
            assertEquals(3, barrierMet.get(), "Üç bayat istek aynı anda sunucuda olmalıydı")

            val requests =
                generateSequence { server.takeRequest(1, java.util.concurrent.TimeUnit.SECONDS) }
                    .map { it.url.encodedPath to it.headers["Authorization"] }
                    .toList()
            val refreshes = requests.count { (path, _) -> path.endsWith("/auth/refresh") }
            // Her yol tam iki kez: bir bayat (401), bir yeni token'la tekrar.
            listOf("a", "b", "c").forEach { name ->
                val bearers = requests.filter { (path, _) -> path.endsWith("/$name") }.map { it.second }
                assertEquals(listOf("Bearer fresh", "Bearer stale"), bearers.sortedBy { it })
            }
            assertEquals(
                1,
                refreshes,
                "Üç eş zamanlı 401 TEK yenileme tetiklemeli; aksi hâlde sunucunun " +
                    "reuse-detection'ı tüm oturum ailesini iptal eder",
            )
        }

    @Test
    @DisplayName("Yenileme sonrası tekrar denenen istek YENİ token'ı taşır")
    fun retriedRequestCarriesFreshToken() =
        runTest {
            signIn(access = "stale")
            server.enqueue(json(problemJson("TOKEN_EXPIRED", 401), code = 401))
            server.enqueue(json("""{"accessToken":"fresh","refreshToken":"r2","expiresIn":900}"""))
            server.enqueue(json("""{"ok":true}"""))

            client.send<Ping>(ApiRequest.get("me"))

            server.takeRequest() // ilk 401
            val refresh = server.takeRequest()
            assertNull(refresh.headers["Authorization"], "/auth/refresh Authorization TAŞIMAMALI")

            val retry = server.takeRequest()
            assertEquals("Bearer fresh", retry.headers["Authorization"])
        }

    @Test
    @DisplayName("Tekrar denenen istek yine 401 alırsa İKİNCİ yenileme YOK")
    fun doesNotRefreshTwiceForOneRequest() =
        runTest {
            signIn(access = "stale")
            server.enqueue(json(problemJson("TOKEN_EXPIRED", 401), code = 401))
            server.enqueue(json("""{"accessToken":"fresh","refreshToken":"r2","expiresIn":900}"""))
            server.enqueue(json(problemJson("TOKEN_EXPIRED", 401), code = 401))

            assertThrows(ApiError.Problem::class.java) {
                kotlinx.coroutines.runBlocking { client.send<Ping>(ApiRequest.get("me")) }
            }

            val paths = generateSequence { server.takeRequest(1, java.util.concurrent.TimeUnit.SECONDS) }
                .map { it.url.encodedPath }
                .toList()
            assertEquals(1, paths.count { it.endsWith("/auth/refresh") })
        }

    @Test
    @DisplayName("bearerOverride 401 alırsa hiç yenileme denenmez")
    fun overrideTokenIsNeverRefreshed() =
        runTest {
            signIn()
            server.enqueue(json(problemJson("MFA_INVALID", 401), code = 401))

            assertThrows(ApiError.Problem::class.java) {
                kotlinx.coroutines.runBlocking {
                    client.send<Ping>(
                        ApiRequest.post("auth/2fa/enable", requiresAuth = false, bearerOverride = "mfa.token"),
                    )
                }
            }

            val paths = generateSequence { server.takeRequest(1, java.util.concurrent.TimeUnit.SECONDS) }
                .map { it.url.encodedPath }
                .toList()
            assertEquals(0, paths.count { it.endsWith("/auth/refresh") })
        }

    @Test
    @DisplayName("Yenileme de başarısızsa: depo temizlenir, oturum sona erme sinyali TAM BİR KEZ")
    fun failedRefreshClearsSessionOnce() =
        runTest {
            signIn(access = "stale")
            server.enqueue(json(problemJson("TOKEN_EXPIRED", 401), code = 401))
            server.enqueue(json(problemJson("TOKEN_EXPIRED", 401), code = 401)) // refresh de 401

            assertThrows(ApiError.Problem::class.java) {
                kotlinx.coroutines.runBlocking { client.send<Ping>(ApiRequest.get("me")) }
            }

            assertNull(tokens.accessToken(), "Yenileme başarısızsa oturum diskte kalmamalı")
            assertEquals(1, expiredCount, "Sona erme tam bir kez haber verilmeli")
        }

    @Test
    @DisplayName("Başarısız yenilemeden SONRA gelen bayat 401: ikinci yenileme ve ikinci sona erme YOK")
    fun lateStaleCallerAfterFailedRefreshDoesNotExpireAgain() =
        runTest {
            // Eş zamanlı üç 401'in üçüncüsü, ilk yenileme başarısız olup oturumu sildikten
            // SONRA yenileyiciye ulaşabilir. Eskiden depo boş diye yeniden yenilemeye
            // girer, refresh token'ı bulamaz ve `onExpired`'ı ikinci kez tetiklerdi.
            signIn(access = "stale")
            server.enqueue(json(problemJson("TOKEN_EXPIRED", 401), code = 401)) // refresh 401
            val refresher =
                OkHttpFactory.create(tokens, scope, onExpired = { expiredCount++ }, baseUrl = baseUrl).refresher

            assertNull(refresher.refresh("stale"))
            assertNull(refresher.refresh("stale"))

            assertEquals(1, expiredCount, "Sona erme tam bir kez haber verilmeli")
            server.takeRequest() // tek yenileme
            assertNull(server.takeRequest(200, java.util.concurrent.TimeUnit.MILLISECONDS))
        }

    // ------------------------------------------------------------ send çeşitleri

    @Test
    @DisplayName("sendOptional: boş gövdeli 200 null döner")
    fun sendOptionalReturnsNullForEmptyBody() =
        runTest {
            signIn()
            server.enqueue(MockResponse.Builder().code(200).build())

            // GET /integrations/whatsapp hesap kurulmamışken boş gövde döndürüyor;
            // bu BEKLENEN bir sonuçtur, bozuk yanıt değil.
            val result = client.sendOptional<Ping>(ApiRequest.get("integrations/whatsapp"))
            assertNull(result)
        }

    @Test
    @DisplayName("sendOptional: dolu gövdede nesne döner")
    fun sendOptionalReturnsObjectWhenPresent() =
        runTest {
            signIn()
            server.enqueue(json("""{"ok":true,"name":"kurulu"}"""))
            assertEquals("kurulu", client.sendOptional<Ping>(ApiRequest.get("integrations/whatsapp"))?.name)
        }

    @Test
    @DisplayName("sendVoid: 204'te çözümleme denenmez")
    fun sendVoidDoesNotDecode() =
        runTest {
            signIn()
            server.enqueue(MockResponse.Builder().code(204).build())
            client.sendVoid(ApiRequest.post("auth/logout"))
        }

    // -------------------------------------------------------- imzalı yükleme

    @Test
    @DisplayName("İmzalı yükleme YALNIZ Content-Type taşır — kimlik başlıklarının YOKLUĞU")
    fun signedUploadCarriesNoIdentityHeaders() =
        runTest {
            signIn()
            val storage = MockWebServer()
            storage.start()
            try {
                storage.enqueue(MockResponse.Builder().code(200).build())

                uploader.upload(storage.url("/bucket/key?sig=abc").toString(), byteArrayOf(1, 2, 3), "image/jpeg")

                val request = storage.takeRequest()
                assertEquals("image/jpeg", request.headers["Content-Type"])
                assertNull(request.headers["Authorization"], "Oturum bearer'ı nesne depolamasına SIZMAMALI")
                assertNull(request.headers["X-Branch-Id"])
                assertNull(request.headers["X-Request-Id"])
                assertNull(request.headers["Accept"])
            } finally {
                storage.close()
            }
        }

    @Test
    @DisplayName("İmzalı yükleme 403: UploadFailed, sıfır yenileme")
    fun signedUploadFailureDoesNotRefresh() =
        runTest {
            signIn()
            val storage = MockWebServer()
            storage.start()
            try {
                storage.enqueue(MockResponse.Builder().code(403).build())

                val error =
                    assertThrows(ApiError.UploadFailed::class.java) {
                        kotlinx.coroutines.runBlocking {
                            uploader.upload(storage.url("/bucket/key").toString(), byteArrayOf(1), "image/jpeg")
                        }
                    }
                assertEquals(403, error.httpStatus)
                assertNull(
                    server.takeRequest(200, java.util.concurrent.TimeUnit.MILLISECONDS),
                    "Süresi dolan imza yeni bir presign ister, yeni access token değil",
                )
            } finally {
                storage.close()
            }
        }

    // ---------------------------------------------------------------- taşıma

    @Test
    @DisplayName("İptal edilen çağrı CancellationException fırlatır, ApiError.Network DEĞİL")
    fun cancellationIsNotReportedAsNetworkFailure() =
        runTest {
            signIn()
            // Yanıt hiç gelmesin: isteği biz iptal edeceğiz.
            server.enqueue(
                MockResponse.Builder()
                    .code(200)
                    .body("""{"ok":true}""")
                    .bodyDelay(5, java.util.concurrent.TimeUnit.SECONDS)
                    .build(),
            )

            val job = scope.async { client.send<Ping>(ApiRequest.get("slow")) }
            // İstek yola çıksın, sonra kullanıcı ekrandan ayrılsın.
            server.takeRequest(2, java.util.concurrent.TimeUnit.SECONDS)
            job.cancel()

            // OkHttp iptali IOException("Canceled") olarak yüzeye çıkarır. Bunu
            // ApiError.Network'e eşlemek her gezinmeyi sahte bir "bağlantı hatası"
            // afişine çevirirdi.
            // assertThrows'un kendisi iddiadır: ApiError.Network gelseydi tip
            // uyuşmazlığından kırılırdı.
            assertThrows(java.util.concurrent.CancellationException::class.java) {
                kotlinx.coroutines.runBlocking { job.await() }
            }
        }

    @Test
    @DisplayName("Bağlantı koparsa ApiError.Network")
    fun transportFailureBecomesNetworkError() =
        runTest {
            signIn()
            server.close()

            assertThrows(ApiError.Network::class.java) {
                kotlinx.coroutines.runBlocking { client.send<Ping>(ApiRequest.get("me")) }
            }
        }

}
