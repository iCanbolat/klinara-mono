package com.klinara.android.features.notifications

import com.klinara.android.services.integrations.MockWhatsAppService
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.Message
import com.klinara.android.services.notifications.MessageFilter
import com.klinara.android.services.notifications.MessageStatus
import com.klinara.android.services.notifications.MessagesService
import com.klinara.android.services.notifications.MockMessagesService
import com.klinara.android.services.notifications.MockNotificationsSeed
import com.klinara.android.services.notifications.NotificationEvent
import com.klinara.android.services.networking.Page
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
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
import java.time.Instant

/** iOS `Phase8StoreTests` — mesaj günlüğü ve gelen kutusu dilimi. */
@OptIn(ExperimentalCoroutinesApi::class)
class MessageLogViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    private val now = Instant.parse("2026-09-11T09:00:00Z")

    private fun messages() = MockMessagesService(latencyEnabled = false, now = { now })

    @Test
    @DisplayName("İmleçle yürümek beş satırı tekrarsız ve en yeni önce getiriyor")
    fun pagesThroughEverything() =
        runTest(dispatcher) {
            val viewModel = MessageLogViewModel(messages())
            viewModel.load()
            advanceUntilIdle()
            assertEquals(3, viewModel.state.value.messages.valueOrNull?.size)
            assertNotNull(viewModel.state.value.nextCursor)

            viewModel.loadMore()
            advanceUntilIdle()

            val rows = viewModel.state.value.messages.valueOrNull.orEmpty()
            assertEquals(5, rows.size)
            assertEquals(5, rows.map { it.id }.toSet().size)
            assertEquals(rows.sortedByDescending { it.createdAt }, rows)
            assertNull(viewModel.state.value.nextCursor)
        }

    @Test
    @DisplayName("Süzgeç değişince imleç SIFIRLANIR; `skipped` satırı gizlenmez")
    fun filterResetsCursor() =
        runTest(dispatcher) {
            val viewModel = MessageLogViewModel(messages())
            viewModel.load()
            advanceUntilIdle()

            viewModel.setStatus(MessageStatusFilter.Skipped)
            advanceUntilIdle()

            val state = viewModel.state.value
            assertNull(state.nextCursor)
            assertEquals(
                listOf(MockNotificationsSeed.MESSAGE_BIRTHDAY_SKIPPED),
                state.messages.valueOrNull?.map { it.id },
            )
            assertTrue(state.filter.isActive)
        }

    @Test
    @DisplayName("Aynı süzgeç yeniden seçilirse istek ATILMAZ")
    fun sameFilterIsNoOp() =
        runTest(dispatcher) {
            val counting = CountingMessages(messages())
            val viewModel = MessageLogViewModel(counting)
            viewModel.load()
            advanceUntilIdle()

            viewModel.setStatus(MessageStatusFilter.All)
            viewModel.clearFilters()
            advanceUntilIdle()

            assertEquals(1, counting.calls)
        }

    @Test
    @DisplayName("Özet sayaçları yüklenmiş satırlardan çıkar")
    fun summaryCountsLoadedRows() =
        runTest(dispatcher) {
            val viewModel = MessageLogViewModel(messages())
            viewModel.load()
            advanceUntilIdle()

            val state = viewModel.state.value
            val rows = state.rows
            assertEquals(rows.size, state.summary.total)
            assertEquals(rows.count { it.status == MessageStatus.Failed }, state.summary.failed)
            assertEquals(rows.count { it.status == MessageStatus.Skipped }, state.summary.skipped)
        }

    @Test
    @DisplayName("Satırlar şube saatinde güne göre gruplanır; sıra korunur")
    fun groupsByBranchDay() =
        runTest(dispatcher) {
            val viewModel = MessageLogViewModel(messages())
            viewModel.load()
            advanceUntilIdle()

            val clock = BranchClock("Europe/Istanbul")
            val groups = viewModel.state.value.groups(clock)

            // Gruplar en yeniden eskiye: sunucunun sırası korunuyor, yeniden sıralanmıyor.
            assertEquals(groups.map { it.day }.sortedDescending(), groups.map { it.day })
            // Hiçbir satır kaybolmadı, hiçbiri iki gruba düşmedi.
            assertEquals(viewModel.state.value.rows, groups.flatMap { it.messages })
            // Bir grubun içindeki her satır gerçekten o güne ait.
            groups.forEach { group ->
                group.messages.forEach { assertEquals(group.day, clock.startOfDay(it.createdAt)) }
            }
        }

    @Test
    @DisplayName("Süzgeçleri temizlemek durum ve olayı birlikte sıfırlar")
    fun clearFiltersResetsBoth() =
        runTest(dispatcher) {
            val viewModel = MessageLogViewModel(messages())
            viewModel.load()
            advanceUntilIdle()

            viewModel.setStatus(MessageStatusFilter.Failed)
            viewModel.toggleEvent(NotificationEvent.AppointmentReminder)
            advanceUntilIdle()
            assertTrue(viewModel.state.value.filter.hasUserFilters)

            viewModel.clearFilters()
            advanceUntilIdle()

            val state = viewModel.state.value
            assertEquals(MessageStatusFilter.All, state.status)
            assertNull(state.event)
            assertFalse(state.filter.hasUserFilters)
        }

    @Test
    @DisplayName("Özet şeridinde seçili sayaca ikinci dokunuş süzgeci kaldırır")
    fun toggleStatusClearsWhenRepeated() =
        runTest(dispatcher) {
            val viewModel = MessageLogViewModel(messages())
            viewModel.load()
            advanceUntilIdle()

            viewModel.toggleStatus(MessageStatusFilter.Failed)
            advanceUntilIdle()
            assertEquals(MessageStatusFilter.Failed, viewModel.state.value.status)

            viewModel.toggleStatus(MessageStatusFilter.Failed)
            advanceUntilIdle()
            assertEquals(MessageStatusFilter.All, viewModel.state.value.status)
        }

    @Test
    @DisplayName("Seçili olay çipine ikinci dokunuş süzgeci kaldırır")
    fun eventChipToggles() =
        runTest(dispatcher) {
            val viewModel = MessageLogViewModel(messages())
            viewModel.load()
            advanceUntilIdle()

            viewModel.toggleEvent(NotificationEvent.AppointmentReminder)
            advanceUntilIdle()
            assertEquals(2, viewModel.state.value.messages.valueOrNull?.size)

            viewModel.toggleEvent(NotificationEvent.AppointmentReminder)
            advanceUntilIdle()
            assertNull(viewModel.state.value.event)
        }

    @Test
    @DisplayName("Sonraki sayfa düşerse satırlar KORUNUR ve hata görünür (iOS'ta spinner takılıyordu)")
    fun loadMoreFailureIsVisible() =
        runTest(dispatcher) {
            val service = messages()
            val viewModel = MessageLogViewModel(service)
            viewModel.load()
            advanceUntilIdle()

            service.failNextPage = true
            viewModel.loadMore()
            advanceUntilIdle()

            val failed = viewModel.state.value
            assertEquals(3, failed.messages.valueOrNull?.size)
            assertNotNull(failed.loadMoreError)
            assertNotNull(failed.nextCursor, "İmleç korunur — tekrar dene aynı sayfayı ister")

            viewModel.loadMore()
            advanceUntilIdle()
            assertEquals(5, viewModel.state.value.messages.valueOrNull?.size)
            assertNull(viewModel.state.value.loadMoreError)
        }

    @Test
    @DisplayName("İmleçsiz `loadMore` hiçbir şey yapmaz")
    fun loadMoreWithoutCursor() =
        runTest(dispatcher) {
            val counting = CountingMessages(messages())
            val viewModel = MessageLogViewModel(counting)
            viewModel.loadMore()
            advanceUntilIdle()

            assertEquals(0, counting.calls)
            assertTrue(viewModel.state.value.messages is Loadable.Loading)
        }

    @Test
    @DisplayName("Detay mesajı günlüğün ViewModel'inden okur — ayrı bir uç yok")
    fun detailReadsFromLog() =
        runTest(dispatcher) {
            val viewModel = MessageLogViewModel(messages())
            viewModel.load()
            advanceUntilIdle()

            val first = viewModel.state.value.messages.valueOrNull!!.first()
            assertEquals(first, viewModel.message(first.id))
            assertNull(viewModel.message("yok"))
        }

    @Test
    @DisplayName("Gelen kutusu: işlenmemiş süzgecinde işaretlenen satır DÜŞER, 'Tümü'nde damgalanır")
    fun inboxMarkHandled() =
        runTest(dispatcher) {
            val unhandled = InboxViewModel(MockWhatsAppService(latencyEnabled = false, now = { now }), now = { now })
            unhandled.load()
            advanceUntilIdle()
            assertEquals(2, unhandled.state.value.items.valueOrNull?.size)

            unhandled.markHandled(MockNotificationsSeed.INBOX_AYSE)
            advanceUntilIdle()
            assertEquals(
                listOf(MockNotificationsSeed.INBOX_UNKNOWN),
                unhandled.state.value.items.valueOrNull
                    ?.map { it.id },
            )

            val all = InboxViewModel(MockWhatsAppService(latencyEnabled = false, now = { now }), now = { now })
            all.setFilter(InboxFilter.All)
            advanceUntilIdle()
            all.markHandled(MockNotificationsSeed.INBOX_UNKNOWN)
            advanceUntilIdle()
            val rows = all.state.value.items.valueOrNull.orEmpty()
            assertEquals(3, rows.size)
            assertTrue(rows.first { it.id == MockNotificationsSeed.INBOX_UNKNOWN }.isHandled)
            assertFalse(all.state.value.isSaving)
        }

    @Test
    @DisplayName("Gelen kutusu işaretleme hatası YUTULMAZ, liste yerinde kalır")
    fun inboxMarkFailure() =
        runTest(dispatcher) {
            val service = MockWhatsAppService(latencyEnabled = false, now = { now })
            val viewModel = InboxViewModel(service, now = { now })
            viewModel.load()
            advanceUntilIdle()

            viewModel.markHandled("bilinmeyen")
            advanceUntilIdle()

            assertNotNull(viewModel.state.value.error)
            assertEquals(2, viewModel.state.value.items.valueOrNull?.size)
        }

    @Test
    @DisplayName("Mock günlük `Ulaştı` süzgecinde okunanları getirmez — ekrandaki dipnotun sebebi")
    fun deliveredExcludesRead() =
        runTest(dispatcher) {
            val page = messages().messages(limit = 50, filter = MessageFilter(status = MessageStatus.Delivered))
            assertEquals(listOf(MockNotificationsSeed.MESSAGE_CONFIRMATION_DELIVERED), page.data.map { it.id })
        }

    private class CountingMessages(
        private val inner: MessagesService,
    ) : MessagesService {
        var calls = 0

        override suspend fun messages(
            cursor: String?,
            limit: Int?,
            filter: MessageFilter,
        ): Page<Message> {
            calls += 1
            return inner.messages(cursor, limit, filter)
        }
    }
}
