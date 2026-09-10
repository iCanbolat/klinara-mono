package com.klinara.android.services.notifications

import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

class MockOptOutTest {
    private fun subject() = MockNotificationsService(latencyEnabled = false)

    @Test
    @DisplayName("Kanalsız kayıt TÜM kanalları kapatır — `null` 'bilinmiyor' değil")
    fun nullChannelMeansEverything() =
        runTest {
            val record = subject().createOptOut("c1", channel = null)

            assertNull(record.channel)
            assertEquals("Tüm kanallar", record.channelLabel)
        }

    @Test
    @DisplayName("Aynı kapsam İKİ KEZ kapatılamaz — idempotent")
    fun optOutIsIdempotent() =
        runTest {
            val service = subject()
            val first = service.createOptOut("c1", NotificationChannel.Sms)
            val second = service.createOptOut("c1", NotificationChannel.Sms)

            // İki özdeş satır çizmek, kullanıcıya aynı reddi iki kez göstermek olurdu.
            assertEquals(first.id, second.id)
            assertEquals(1, service.optOuts("c1").size)
        }

    @Test
    @DisplayName("Reddin kapsamı HER ZAMAN pazarlama — işlemsel ileti kapatılamaz")
    fun optOutIsAlwaysMarketing() =
        runTest {
            // Randevu hatırlatması ticari ileti değildir; bu kayıt onu durduramaz ve
            // ekran bunu dipnotta söylüyor.
            assertEquals("marketing", subject().createOptOut("c1", NotificationChannel.Email).kind)
        }

    @Test
    @DisplayName("Kayıtlar müşteriye göre ayrışır")
    fun recordsAreScopedToTheCustomer() =
        runTest {
            val service = subject()
            service.createOptOut("c1", NotificationChannel.Sms)

            assertTrue(service.optOuts("c2").isEmpty())
        }

    @Test
    @DisplayName("Geri alma kaydı düşürür; olmayan reddi geri almak 404")
    fun revokeRemovesTheRecord() =
        runTest {
            val service = subject()
            service.createOptOut("c1", NotificationChannel.Sms)

            service.revokeOptOut("c1", NotificationChannel.Sms)
            assertTrue(service.optOuts("c1").isEmpty())

            assertTrue(
                runCatching { service.revokeOptOut("c1", NotificationChannel.Sms) }
                    .exceptionOrNull() is ApiError.Problem,
            )
        }

    @Test
    @DisplayName("Kanalsız geri alma müşterinin TÜM reddlerini kaldırır")
    fun revokingAllClearsEveryChannel() =
        runTest {
            val service = subject()
            service.createOptOut("c1", NotificationChannel.Sms)
            service.createOptOut("c1", NotificationChannel.Email)

            service.revokeOptOut("c1", channel = null)

            assertTrue(service.optOuts("c1").isEmpty())
        }

    @Test
    @DisplayName("Bilinmeyen kanal çözümlemeyi düşürmez")
    fun unknownChannelFallsBack() {
        assertEquals(NotificationChannel.Unknown, NotificationChannel.from("telegram"))
        assertEquals(OptOutSource.Unknown, OptOutSource.from("robot"))
        // `Unknown` seçilebilir listede YOK: bir kurtarma dalıdır, bir seçenek değil.
        assertTrue(NotificationChannel.Unknown !in NotificationChannel.selectable)
    }
}
