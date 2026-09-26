package com.klinara.android.services.conversations

import com.klinara.android.services.auth.TokenStore
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.OkHttpFactory
import com.klinara.android.services.networking.testTokenStore
import com.klinara.android.services.networking.tokens
import com.klinara.android.services.notifications.MessageStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.ListSerializer
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * Sohbet sözleşmesi: gerçek sunucu gövdeleri (`klinara-fixtures/conversations/`) ve kablo
 * düzeyinde yollar/gövdeler — MockWebServer üzerinde.
 */
class ConversationsServiceTest {
    private lateinit var server: MockWebServer
    private lateinit var scope: CoroutineScope
    private lateinit var tokenStore: TokenStore
    private lateinit var service: LiveConversationsService

    @BeforeEach
    fun setUp() {
        server = MockWebServer()
        server.start()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        tokenStore = testTokenStore()
        val baseUrl = server.url("/api/v1/")
        val clients = OkHttpFactory.create(tokens = tokenStore, scope = scope, onExpired = {}, baseUrl = baseUrl)
        service = LiveConversationsService(ApiClient(clients.api, baseUrl))
    }

    @AfterEach
    fun tearDown() {
        scope.cancel()
        server.close()
    }

    private suspend fun signIn() {
        tokenStore.save(tokens("access-1"))
        tokenStore.warmUp()
    }

    private fun json(
        body: String,
        code: Int = 200,
    ) = MockResponse.Builder().code(code).setHeader("Content-Type", "application/json").body(body).build()

    // --- Çözümleme ---

    @Test
    @DisplayName("Ayrıntı: pencere kapalı; gelen, serbest cevap ve şablon aynı akışta")
    fun decodesDetail() {
        val detail =
            KlinaraJson.decodeFromString(
                ConversationDetail.serializer(),
                Fixtures.read("conversations/detail-window-closed.json"),
            )
        assertFalse(detail.conversation.windowOpen)
        assertNull(ConversationFormat.windowRemaining(detail.conversation))
        assertEquals(listOf("text", "text", "template"), detail.messages.map { it.type })
        val template = detail.messages.last()
        assertTrue(template.isTemplate)
        assertEquals(MessageStatus.Sent, template.status)
        assertEquals("Klinik Sahibi · Şablon", template.senderLabel)
    }

    @Test
    @DisplayName("Şablon seçenekleri: bilinmeyen değişken adı null, öneriler konum sırasıyla")
    fun decodesTemplateOptions() {
        val options =
            KlinaraJson.decodeFromString(
                ListSerializer(ConversationTemplateOption.serializer()),
                Fixtures.read("conversations/template-options.json"),
            )
        val starter = options.first()
        assertEquals("klinara_gelmedi_takip", starter.name)
        assertEquals("Müşteri adı", starter.label(0))
        assertEquals("Ayşe Yılmaz", starter.suggestedParameters.first())
        assertEquals("1. değişken", options.last().label(0))
        assertTrue(starter.render(listOf("Ayşe", "Kadıköy")).startsWith("Merhaba Ayşe, bugünkü randevunuza"))
        assertTrue(starter.render(listOf("Ayşe", " ")).contains("{{2}}"))
    }

    @Test
    @DisplayName("Başarısız gönderim HTTP hatası değil — `failed` mesaj")
    fun decodesFailedMessage() {
        val message =
            KlinaraJson.decodeFromString(
                ConversationMessage.serializer(),
                Fixtures.read("conversations/message-failed.json"),
            )
        assertTrue(message.isFailed)
        assertFalse(message.errorDetail.isNullOrEmpty())
    }

    // --- Kablo ---

    @Test
    @DisplayName("Okunmamış süzgeci `status=open&unreadOnly=true` gönderir; sayfa çözülür")
    fun listQuery() =
        runTest {
            signIn()
            server.enqueue(json(Fixtures.read("conversations/list-page.json")))

            val page = service.conversations(ConversationFilter.Unread, cursor = "abc")

            val request = server.takeRequest()
            assertEquals("/api/v1/conversations", request.url.encodedPath)
            assertEquals("open", request.url.queryParameter("status"))
            assertEquals("true", request.url.queryParameter("unreadOnly"))
            assertEquals("abc", request.url.queryParameter("cursor"))
            assertTrue(page.pageInfo.hasMore)
            assertNull(page.data.first().customer)
        }

    @Test
    @DisplayName("Şablon gönderimi yolu ve gövdesi")
    fun sendTemplateBody() =
        runTest {
            signIn()
            server.enqueue(json(Fixtures.read("conversations/template-sent.json"), code = 201))

            val message = service.sendTemplate("c1", "klinara_gelmedi_takip", "tr", listOf("Ayşe", "Nişantaşı"))

            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("/api/v1/conversations/c1/template", request.url.encodedPath)
            assertEquals(
                """{"templateName":"klinara_gelmedi_takip","language":"tr","parameters":["Ayşe","Nişantaşı"]}""",
                request.body!!.utf8(),
            )
            assertTrue(message.isTemplate)
        }

    @Test
    @DisplayName("Pencere kapalı 422 kendi koduyla fırlar")
    fun windowClosedProblem() =
        runTest {
            signIn()
            server.enqueue(
                MockResponse.Builder()
                    .code(422)
                    .setHeader("Content-Type", "application/problem+json")
                    .body(Fixtures.read("conversations/window-closed-problem.json"))
                    .build(),
            )

            val error = assertThrows<ApiError> { service.send("c1", "Merhaba") }
            assertEquals(ApiErrorCode.WHATSAPP_WINDOW_CLOSED, error.code)
        }
}
