package com.klinara.android.services.integrations

import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.notifications.MockNotificationsSeed
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.random.Random

/**
 * WhatsApp ve gelen kutusu mock'u — iOS `MockWhatsAppService` paritesi.
 *
 * A8.1'de yalnız gelen kutusu: tanınmayan numaradan bir mesaj ve işlenmiş bir görsel
 * tohumlanmış, "Kayıtlı müşteri değil" ve "İşlendi" rozetleri ancak böyle sürülebilir.
 */
class MockWhatsAppService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
    private val now: () -> Instant = Instant::now,
) : WhatsAppService {
    var failing: Boolean = false

    private val inboxRecords: MutableList<InboxItem> = MockNotificationsSeed.inbox(now()).toMutableList()

    override suspend fun inbox(
        onlyUnhandled: Boolean,
        limit: Int?,
    ): List<InboxItem> {
        settle()
        val filtered =
            inboxRecords
                .filter { !onlyUnhandled || !it.isHandled }
                .sortedByDescending { it.receivedAt }
        return if (limit == null) filtered else filtered.take(limit)
    }

    override suspend fun markInboxHandled(id: String) {
        settle()
        val index = inboxRecords.indexOfFirst { it.id == id }
        if (index < 0) throw MockErrors.notFound("Mesaj")
        inboxRecords[index] = inboxRecords[index].copy(handledAt = now())
    }

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    private companion object {
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
    }
}
