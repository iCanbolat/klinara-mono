package com.klinara.android.services.notifications

import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.PageInfo
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.random.Random

/**
 * Mesaj günlüğü mock'u — **gerçek keyset imleci** uygular (iOS `MockMessagesService` paritesi).
 *
 * Tek sayfa döndüren bir mock, ekranın sonsuz kaydırmasını ve "süzgeç değişince imleci
 * sıfırla" davranışını sınanmaz bırakırdı — ikisi de sessizce bozulabilecek yerler.
 */
class MockMessagesService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
    now: () -> Instant = Instant::now,
    /** Sunucunun 50'si DEĞİL: beş satırlık tohumda bile ikinci sayfa gerçekten oluşsun. */
    private val defaultPageSize: Int = DEFAULT_PAGE_SIZE,
) : MessagesService {
    var failing: Boolean = false

    /** Sayfa isteklerinden biri düşsün diye (testler: "sonraki sayfa hatası yutulmaz"). */
    var failNextPage: Boolean = false

    private val records: MutableList<Message> = MockNotificationsSeed.messages(now()).toMutableList()

    /**
     * Yeni bir mesaj günlüğe düşsün diye — WhatsApp test gönderimi mock'u bunu çağırıyor.
     * Gerçek sunucuda ikisi aynı `message_log` tablosuna yazıyor.
     */
    fun record(message: Message) {
        records.add(0, message)
    }

    override suspend fun messages(
        cursor: String?,
        limit: Int?,
        filter: MessageFilter,
    ): Page<Message> {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
        if (cursor != null && failNextPage) {
            failNextPage = false
            throw ApiError.Network()
        }

        // Sunucunun sırası: `created_at DESC, id DESC` — en yeni önce.
        val sorted =
            records
                .filter { it.matches(filter) }
                .sortedWith(compareByDescending<Message> { it.createdAt }.thenByDescending { it.id })
        val start = cursor?.let { key -> sorted.indexOfFirst { it.cursorKey() == key } + 1 } ?: 0
        val size = (limit ?: defaultPageSize).coerceAtMost(MAX_LIMIT)
        val end = (start + size).coerceAtMost(sorted.size)
        if (start >= end) return Page.empty()
        val page = sorted.subList(start, end)
        val hasMore = end < sorted.size
        return Page(page.toList(), PageInfo(nextCursor = page.last().cursorKey().takeIf { hasMore }, hasMore = hasMore))
    }

    private fun Message.cursorKey(): String = "${createdAt.toEpochMilli()}|$id"

    private fun Message.matches(filter: MessageFilter): Boolean =
        (filter.customerId == null || customerId == filter.customerId) &&
            (filter.channel == null || channel == filter.channel) &&
            (filter.event == null || event == filter.event) &&
            (filter.status == null || status == filter.status) &&
            (filter.from == null || createdAt >= filter.from) &&
            (filter.to == null || createdAt <= filter.to)

    private companion object {
        const val DEFAULT_PAGE_SIZE = 3
        const val MAX_LIMIT = 200
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
    }
}
