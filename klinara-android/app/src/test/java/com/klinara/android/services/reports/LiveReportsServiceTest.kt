package com.klinara.android.services.reports

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.OkHttpFactory
import com.klinara.android.services.networking.problemJson
import com.klinara.android.services.networking.testTokenStore
import com.klinara.android.services.networking.tokens
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

/** Rapor uçlarının kablo sözleşmesi — sorgu dizgesi ve dışa aktarım gövdesi. */
class LiveReportsServiceTest {
    private lateinit var server: MockWebServer
    private lateinit var scope: CoroutineScope
    private lateinit var service: LiveReportsService

    private val september =
        ReportPeriod(Instant.parse("2026-08-31T21:00:00Z"), Instant.parse("2026-09-30T21:00:00Z"))

    @BeforeEach
    fun setUp() =
        runTest {
            server = MockWebServer()
            server.start()
            scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            val baseUrl = server.url("/api/v1/")
            val store = testTokenStore()
            store.save(tokens("access-1"))
            store.setBranch("branch-nisantasi")
            store.warmUp()
            val clients = OkHttpFactory.create(tokens = store, scope = scope, onExpired = {}, baseUrl = baseUrl)
            service = LiveReportsService(ApiClient(clients.api, baseUrl))
        }

    @AfterEach
    fun tearDown() {
        scope.cancel()
        server.close()
    }

    private fun respond(
        body: String,
        code: Int = 200,
    ) = server.enqueue(MockResponse.Builder().code(code).body(body).build())

    private fun RecordedRequest.param(name: String): String? = url.queryParameter(name)

    @Test
    @DisplayName("Doluluk: yarı açık UTC aralık, groupBy, limit; compareTo YALNIZ istenince")
    fun occupancyQuery() =
        runTest {
            respond(Fixtures.read("reports/occupancy.json"))
            service.occupancy(ReportQuery(september, branchId = null), OccupancyGrouping.Day, ReportPage(limit = 50))

            val first = server.takeRequest()
            assertEquals("/api/v1/reports/occupancy", first.url.encodedPath)
            assertEquals("2026-08-31T21:00:00Z", first.param("from"))
            assertEquals("2026-09-30T21:00:00Z", first.param("to"))
            assertEquals("day", first.param("groupBy"))
            assertEquals("50", first.param("limit"))
            assertNull(first.param("compareTo"), "varsayılan `none`; her isteğe yazmak gereksiz")
            assertNull(first.param("branchId"), "null şube = 'erişebildiğim şubeler', parametre YOK")

            respond(Fixtures.read("reports/occupancy.json"))
            service.occupancy(
                ReportQuery(september, branchId = "b-1", compareToPrevious = true),
                OccupancyGrouping.Staff,
                ReportPage(limit = 50, cursor = "abc"),
            )
            val second = server.takeRequest()
            assertEquals("previous", second.param("compareTo"))
            assertEquals("b-1", second.param("branchId"))
            assertEquals("abc", second.param("cursor"))
        }

    @Test
    @DisplayName("Personel performansı compareTo GÖNDERMİYOR; kazanım sayfalanmıyor")
    fun staffPerformanceAndRetentionQueries() =
        runTest {
            val compared = ReportQuery(september, branchId = null, compareToPrevious = true)

            respond(Fixtures.read("reports/staff-performance.json"))
            service.staffPerformance(compared, ReportPage(limit = 50))
            val staff = server.takeRequest()
            assertEquals("/api/v1/reports/staff-performance", staff.url.encodedPath)
            assertNull(staff.param("compareTo"))
            assertNull(staff.param("groupBy"))

            respond(Fixtures.read("reports/retention.json"))
            service.retention(compared)
            val retention = server.takeRequest()
            assertEquals("previous", retention.param("compareTo"))
            assertNull(retention.param("limit"))
        }

    @Test
    @DisplayName("Dışa aktarım: POST gövdesinde filtre, sorgu dizgesi BOŞ; ham baytlar dönüyor")
    fun exportPostsFilterInBody() =
        runTest {
            val csv = "\uFEFFKırılım;Ciro\r\nCilt bakımı;900,00\r\n".toByteArray()
            server.enqueue(
                MockResponse
                    .Builder()
                    .code(200)
                    .addHeader("Content-Type", "text/csv; charset=utf-8")
                    .body(okio.Buffer().write(csv))
                    .build(),
            )

            val bytes =
                service.export(
                    ReportKind.Revenue,
                    ReportQuery(september, branchId = "b-1", compareToPrevious = true),
                    RevenueGrouping.Staff.wire,
                )

            assertArrayEquals(csv, bytes)
            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("/api/v1/reports/revenue/export", request.url.encodedPath)
            assertNull(request.url.query, "tarih aralığı ve şube erişim loglarına düşmemeli")
            val body = Json.parseToJsonElement(request.body!!.utf8()).jsonObject
            assertEquals(setOf("from", "to", "branchId", "groupBy"), body.keys)
            assertEquals("staff", body["groupBy"]!!.jsonPrimitive.content)
        }

    @Test
    @DisplayName("Dışa aktarımın sorunu problem+json olarak çözülüyor (aralığı daraltın)")
    fun exportProblemIsDecoded() =
        runTest {
            respond(problemJson("VALIDATION_FAILED", 400, title = "Rapor çok büyük"), code = 400)

            val error =
                runCatching { service.export(ReportKind.NoShow, ReportQuery(september, null), "day") }
                    .exceptionOrNull() as ApiError

            assertEquals(ApiErrorCode.VALIDATION_FAILED, error.code)
        }
}
