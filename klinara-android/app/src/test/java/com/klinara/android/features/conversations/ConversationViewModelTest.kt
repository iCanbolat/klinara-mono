package com.klinara.android.features.conversations

import com.klinara.android.services.conversations.ConversationFilter
import com.klinara.android.services.conversations.MockConversationsService
import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.networking.Loadable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/** iOS `ConversationStoreTests` paritesi. */
@OptIn(ExperimentalCoroutinesApi::class)
class ConversationViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    private fun service() = MockConversationsService(latencyEnabled = false)

    private fun thread(
        service: MockConversationsService,
        id: String,
    ) = ConversationThreadViewModel(service, id)

    // --- Liste ---

    @Test
    @DisplayName("Süzgeçler: açık, okunmamış, kapalı")
    fun filters() =
        runTest(dispatcher) {
            val viewModel = ConversationListViewModel(service())
            viewModel.load()
            advanceUntilIdle()
            fun ids() = viewModel.state.value.conversations.valueOrNull?.map { it.id }

            assertEquals(listOf(MockConversationsService.OPEN_ID, MockConversationsService.CLOSED_WINDOW_ID), ids())
            viewModel.setFilter(ConversationFilter.Unread)
            advanceUntilIdle()
            assertEquals(listOf(MockConversationsService.OPEN_ID), ids())
            viewModel.setFilter(ConversationFilter.Closed)
            advanceUntilIdle()
            assertEquals(listOf(MockConversationsService.ARCHIVED_ID), ids())
        }

    @Test
    @DisplayName("Akıştaki kapatma listeye yansır; süzgece uymayan satır düşer")
    fun listReflectsChanges() =
        runTest(dispatcher) {
            val mock = service()
            val list = ConversationListViewModel(mock)
            list.load()
            val detail = thread(mock, MockConversationsService.OPEN_ID)
            detail.load()
            advanceUntilIdle()

            detail.setClosed(true)
            advanceUntilIdle()
            list.update(detail.state.value.conversation!!)

            val ids = list.state.value.conversations.valueOrNull!!.map { it.id }
            assertFalse(MockConversationsService.OPEN_ID in ids)
        }

    // --- Akış ---

    @Test
    @DisplayName("Açılışta okundu işaretlenir")
    fun marksRead() =
        runTest(dispatcher) {
            val mock = service()
            assertEquals(1, mock.unreadCount())
            val viewModel = thread(mock, MockConversationsService.OPEN_ID)
            viewModel.load()
            advanceUntilIdle()

            assertEquals(false, viewModel.state.value.conversation?.unread)
            assertEquals(0, mock.unreadCount())
        }

    @Test
    @DisplayName("Pencere açıkken serbest metin gider, akışa eklenir, taslak temizlenir")
    fun sendsWhenOpen() =
        runTest(dispatcher) {
            val viewModel = thread(service(), MockConversationsService.OPEN_ID)
            viewModel.load()
            advanceUntilIdle()
            assertTrue(viewModel.state.value.canCompose)
            val before = viewModel.state.value.detail.valueOrNull!!.messages.size
            var cleared = false

            viewModel.send("  Tabii, 15:00 uygun.  ") { cleared = true }
            advanceUntilIdle()

            val messages = viewModel.state.value.detail.valueOrNull!!.messages
            assertEquals(before + 1, messages.size)
            assertEquals("Tabii, 15:00 uygun.", messages.last().body)
            assertTrue(cleared)
        }

    @Test
    @DisplayName("Pencere kapalıyken yazma kutusu yok, yalnız şablon; serbest metin 422 alır")
    fun windowClosed() =
        runTest(dispatcher) {
            val viewModel = thread(service(), MockConversationsService.CLOSED_WINDOW_ID)
            viewModel.load()
            advanceUntilIdle()
            assertFalse(viewModel.state.value.canCompose)
            assertTrue(viewModel.state.value.needsTemplate)

            var cleared = false
            viewModel.send("Merhaba") { cleared = true }
            advanceUntilIdle()
            assertFalse(cleared)
            assertNotNull(viewModel.state.value.actionError)
        }

    @Test
    @DisplayName("Şablon: kayıtsız numarada ad önerilmez; boş alan işaretlenir; gönderim işlenmiş metni ekler")
    fun sendsTemplate() =
        runTest(dispatcher) {
            val viewModel = thread(service(), MockConversationsService.CLOSED_WINDOW_ID)
            viewModel.load()
            viewModel.openTemplates()
            advanceUntilIdle()

            val sheet = viewModel.template.value!!
            assertEquals("klinara_gelmedi_takip", sheet.selected!!.name)
            assertEquals("", sheet.values.first())

            viewModel.sendTemplate()
            advanceUntilIdle()
            assertTrue(viewModel.template.value!!.missing(0))

            viewModel.setTemplateValue(0, "Ayşe")
            viewModel.sendTemplate()
            advanceUntilIdle()

            assertNull(viewModel.template.value)
            val last = viewModel.state.value.detail.valueOrNull!!.messages.last()
            assertTrue(last.isTemplate)
            assertTrue(last.body!!.startsWith("Merhaba Ayşe, bugünkü randevunuza"))
            // Şablon pencereyi AÇMAZ.
            assertFalse(viewModel.state.value.conversation!!.windowOpen)
        }

    @Test
    @DisplayName("Kapat / yeniden aç")
    fun closeReopen() =
        runTest(dispatcher) {
            val viewModel = thread(service(), MockConversationsService.OPEN_ID)
            viewModel.load()
            advanceUntilIdle()
            viewModel.setClosed(true)
            advanceUntilIdle()
            assertTrue(viewModel.state.value.conversation!!.isClosed)
            assertFalse(viewModel.state.value.canCompose || viewModel.state.value.needsTemplate)
            viewModel.setClosed(false)
            advanceUntilIdle()
            assertFalse(viewModel.state.value.conversation!!.isClosed)
        }

    @Test
    @DisplayName("Müşterisiz sohbet müşteriye bağlanır")
    fun linksCustomer() =
        runTest(dispatcher) {
            val customer = MockCustomers.ALL.first()
            val viewModel = thread(service(), MockConversationsService.CLOSED_WINDOW_ID)
            viewModel.load()
            advanceUntilIdle()
            viewModel.linkCustomer(customer.id)
            advanceUntilIdle()
            assertEquals(customer.id, viewModel.state.value.conversation?.customer?.id)
        }

    @Test
    @DisplayName("Yoklama iptal edilince durur")
    fun pollingStops() =
        runTest(dispatcher) {
            val mock = service()
            val viewModel = thread(mock, MockConversationsService.OPEN_ID)
            viewModel.load()
            advanceUntilIdle()

            val job = launch { viewModel.poll(intervalMillis = 1_000) }
            advanceTimeBy(3_500)
            val whileVisible = mock.detailRequestCount
            assertTrue(whileVisible >= 3)

            job.cancel()
            advanceTimeBy(5_000)
            assertEquals(whileVisible, mock.detailRequestCount)
            assertTrue(viewModel.state.value.detail is Loadable.Loaded)
        }
}
