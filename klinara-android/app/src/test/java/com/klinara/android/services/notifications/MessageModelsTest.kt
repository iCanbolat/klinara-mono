package com.klinara.android.services.notifications

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.integrations.InboxItem
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.ProblemDetails
import kotlinx.serialization.builtins.ListSerializer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/** iOS `Phase8DecodingTests` paritesi — gövdeler sunucudan yakalanmış (`klinara-fixtures/notifications`). */
class MessageModelsTest {
    private fun message(json: String): Message = KlinaraJson.decodeFromString(Message.serializer(), json)

    private fun body(
        event: String = "appointment_reminder",
        status: String = "failed",
        channel: String = "whatsapp",
        errorCode: String? = null,
        attempt: Int = 1,
    ) = """
        {
          "id": "cde431f8-13be-4a88-9303-dd27b369f570", "customerId": null, "userId": null,
          "channel": "$channel", "event": "$event", "status": "$status",
          "to": "+90********67", "subject": null, "body": null,
          "errorCode": ${errorCode?.let { "\"$it\"" } ?: "null"},
          "attempt": $attempt, "scheduledFor": "2026-08-29T05:00:00.000Z",
          "sentAt": null, "deliveredAt": null, "createdAt": "2026-08-28T22:36:45.305Z"
        }
        """.trimIndent()

    @Test
    @DisplayName("Mesaj sayfası `{ data, pageInfo }` zarfıyla çözülür; adres maskeli, hiç denenmemiş")
    fun decodesMessagePage() {
        val page =
            KlinaraJson.decodeFromString(
                Page.serializer(Message.serializer()),
                Fixtures.read("notifications/message-page.json"),
            )
        val first = page.data.single()

        assertFalse(page.pageInfo.hasMore)
        assertNull(page.pageInfo.nextCursor)
        assertTrue(first.to.startsWith("+90") && "*" in first.to)
        assertEquals(MessageStatus.Queued, first.status)
        assertEquals(NotificationChannel.Sms, first.channel)
        assertFalse(first.wasAttempted)
        assertNull(first.failureMessage)
    }

    @Test
    @DisplayName("Bilinmeyen durum ve olay `Unknown`a düşer — günlüğün tamamı çözülemez hâle gelmez")
    fun unknownEnumsFallBack() {
        val decoded = message(body(event = "loyalty_reward", status = "expired"))

        assertEquals(NotificationEvent.Unknown, decoded.event)
        assertEquals(MessageStatus.Unknown, decoded.status)
    }

    @Test
    @DisplayName("Hata kodu kullanıcı diline çevrilir, ham kod korunur")
    fun mapsErrorCode() {
        val decoded = message(body(errorCode = "WHATSAPP_INVALID_RECIPIENT"))

        assertEquals("WHATSAPP_INVALID_RECIPIENT", decoded.errorCode)
        assertTrue(decoded.failureMessage!!.contains("WhatsApp'ta geçerli değil"))
    }

    @Test
    @DisplayName("Tanınmayan hata kodu HAM hâliyle gösterilir, yutulmaz")
    fun keepsUnknownCode() {
        assertEquals("SMS_PROVIDER_DOWN", message(body(errorCode = "SMS_PROVIDER_DOWN")).failureMessage)
    }

    @Test
    @DisplayName("OPT_OUT atlanmış mesajda randevu hatırlatmasının etkilenmediğini söyler")
    fun optOutReason() {
        val decoded = message(body(event = "birthday", status = "skipped", errorCode = "OPT_OUT", attempt = 0))

        assertFalse(decoded.wasAttempted)
        assertTrue(decoded.failureMessage!!.contains("Randevu hatırlatmaları bundan etkilenmez"))
    }

    @Test
    @DisplayName("Randevu planı ÇIPLAK dizi; `offsetHours` randevudan ÖNCE")
    fun decodesSchedule() {
        val rows =
            KlinaraJson.decodeFromString(
                ListSerializer(ScheduledNotification.serializer()),
                Fixtures.read("notifications/appointment-notifications.json"),
            )

        assertEquals(listOf(24, 4), rows.map { it.offsetHours })
        assertTrue(rows.all { it.status == ScheduledNotificationStatus.Pending && !it.isFollowup })
        assertEquals("Randevudan 24 saat önce", rows.first().offsetLabel)
    }

    @Test
    @DisplayName("Negatif `offsetHours` gelmedi takibidir — randevudan SONRA; bilinmeyen durum düşmez")
    fun negativeOffsetIsFollowup() {
        val row =
            KlinaraJson.decodeFromString(
                ScheduledNotification.serializer(),
                """
                {"id": "x", "event": "no_show_followup", "offsetHours": -2,
                 "scheduledFor": "2026-09-11T11:00:00.000Z", "status": "archived", "messageId": null}
                """.trimIndent(),
            )

        assertTrue(row.isFollowup)
        assertEquals("Randevudan 2 saat sonra", row.offsetLabel)
        assertEquals(ScheduledNotificationStatus.Unknown, row.status)
    }

    @Test
    @DisplayName("Gelen kutusunun `messageType`'ı enum değil serbest metin; boş gövde tür etiketine düşer")
    fun decodesInboxItem() {
        val item =
            KlinaraJson
                .decodeFromString(
                    ListSerializer(InboxItem.serializer()),
                    """
                    [{"id": "5c11e229-1a38-425a-92a2-aee85bb7427f", "customerId": null,
                      "from": "+90********88", "messageType": "sticker", "body": null,
                      "receivedAt": "2026-08-28T22:36:45.305Z", "handledAt": null}]
                    """.trimIndent(),
                ).single()

        assertEquals("sticker", item.messageTypeLabel)
        assertFalse(item.isHandled)
        assertEquals("(sticker)", item.preview)
    }

    @Test
    @DisplayName("TEMPLATE_INVALID sunucunun `detail`'ini gösterir — izinli değişkenleri sayıyor")
    fun templateInvalidUsesDetail() {
        val problem =
            KlinaraJson.decodeFromString(
                ProblemDetails.serializer(),
                Fixtures.read("notifications/problem-template-invalid.json"),
            )

        assertEquals(ApiErrorCode.TEMPLATE_INVALID, problem.code)
        assertTrue(ApiError.Problem(problem).displayMessage.contains("customerName"))
    }

    @Test
    @DisplayName("WhatsApp kota hatası GEÇİCİ; diğer WhatsApp hataları kalıcı")
    fun onlyRateLimitIsRetryable() {
        fun problem(code: ApiErrorCode) = ApiError.Problem(ProblemDetails(code = code, title = "", status = 422))

        assertTrue(problem(ApiErrorCode.WHATSAPP_RATE_LIMITED).isRetryable)
        listOf(
            ApiErrorCode.WHATSAPP_NOT_CONFIGURED,
            ApiErrorCode.WHATSAPP_TEMPLATE_NOT_APPROVED,
            ApiErrorCode.WHATSAPP_INVALID_RECIPIENT,
            ApiErrorCode.WHATSAPP_WINDOW_CLOSED,
            ApiErrorCode.OPT_OUT,
        ).forEach { assertFalse(problem(it).isRetryable, it.name) }
    }
}
