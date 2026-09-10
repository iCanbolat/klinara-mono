package com.klinara.android.services.notifications

import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.random.Random

/**
 * Opt-out mock'u.
 *
 * Tohum **bilerek boş değil**: bir müşteride zaten kapalı bir kanal var, yoksa "kapalı"
 * hâlin nasıl göründüğü hiç sürülemez ve ekranın uyarı tonu ancak canlıda görülürdü.
 */
class MockNotificationsService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
) : NotificationsService {
    var failing: Boolean = false

    private val records: MutableList<OptOutRecord> = mutableListOf()
    private var idCounter: Int = 0

    override suspend fun optOuts(customerId: String): List<OptOutRecord> {
        settle()
        return records.filter { it.customerId == customerId }
    }

    override suspend fun createOptOut(
        customerId: String,
        channel: NotificationChannel?,
        source: OptOutSource?,
        note: String?,
    ): OptOutRecord {
        settle()

        // Aynı kapsam iki kez kapatılamaz — sunucuda idempotent; mock'ta da öyle olmalı
        // ki ekran iki özdeş satır çizmesin.
        records.firstOrNull { it.customerId == customerId && it.channel == channel }?.let { return it }

        idCounter += 1
        val record =
            OptOutRecord(
                id = "0970000a-0000-4000-8000-%012d".format(idCounter),
                customerId = customerId,
                channel = channel,
                // Reddin kapsamı HER ZAMAN pazarlama: işlemsel ileti kapatılamaz.
                kind = "marketing",
                source = source ?: OptOutSource.Staff,
                createdAt = Instant.parse(SEED_NOW),
            )
        records += record
        return record
    }

    override suspend fun revokeOptOut(
        customerId: String,
        channel: NotificationChannel?,
    ) {
        settle()

        val removed =
            if (channel == null) {
                records.removeAll { it.customerId == customerId }
            } else {
                records.removeAll { it.customerId == customerId && it.channel == channel }
            }
        if (!removed) throw MockErrors.notFound("İleti reddi")
    }

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    private companion object {
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
        const val SEED_NOW = "2026-09-05T08:30:00Z"
    }
}
