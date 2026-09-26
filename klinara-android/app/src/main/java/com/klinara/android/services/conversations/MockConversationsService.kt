package com.klinara.android.services.conversations

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.PageInfo
import com.klinara.android.services.notifications.MessageStatus
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * Sohbetler mock'u — iOS `MockConversationsService` paritesi.
 *
 * Sunucunun kuralları taklit ediliyor:
 * - Pencere kapalıyken serbest metin `422 WHATSAPP_WINDOW_CLOSED`; kayıt bırakılmaz.
 * - Şablon pencereden bağımsız gider; parametre eksikse `422`.
 * - Gönderim hatası HTTP hatası değil, `failed` mesaj — tohumdaki kayıtsız numaranın akışında.
 * - Şablon pencereyi AÇMAZ: müşteri yazana kadar kapalı kalır.
 */
class MockConversationsService(
    private val latencyEnabled: Boolean = true,
    private val now: () -> Instant = Instant::now,
    var failing: Boolean = false,
) : ConversationsService {

    /** Yoklamanın durduğunu sınamak için. */
    var detailRequestCount: Int = 0
        private set

    private val records: MutableList<Conversation> = mutableListOf()
    private val threads: MutableMap<String, MutableList<ConversationMessage>> = mutableMapOf()
    private val templates: List<ConversationTemplateOption> =
        listOf(
            ConversationTemplateOption(
                name = "klinara_gelmedi_takip",
                language = "tr",
                category = "UTILITY",
                bodyText =
                    "Merhaba {{1}}, bugünkü randevunuza gelemediğinizi gördük. " +
                        "Yeni bir randevu için {{2}} şubemize bu mesajı yanıtlayarak ulaşabilirsiniz.",
                bodyVariableCount = 2,
                variableNames = listOf("customerName", "branchName"),
                suggestedParameters = listOf("", "Nişantaşı"),
            ),
            ConversationTemplateOption(
                name = "klinara_paket_bakiye",
                language = "tr",
                category = "UTILITY",
                bodyText =
                    "Merhaba {{1}}, {{2}} paketinizde {{3}} seans hakkınız kaldı. " +
                        "Randevu için bu mesajı yanıtlayabilirsiniz.",
                bodyVariableCount = 3,
                variableNames = listOf("customerName", "packageName", "remainingSessions"),
                suggestedParameters = listOf("", "", ""),
            ),
        )

    init {
        seed()
    }

    private fun seed() {
        val at = now()
        fun ago(minutes: Long) = at.minus(minutes, ChronoUnit.MINUTES)
        detailRequestCount = 0
        records.clear()
        threads.clear()

        records +=
            listOf(
                Conversation(
                    id = OPEN_ID,
                    phone = "+905321112233",
                    customer = ConversationCustomer(AYSE.id, AYSE.fullName),
                    status = ConversationStatus.Open,
                    lastMessageAt = ago(RECENT_MINUTES),
                    lastMessagePreview = "Yarınki randevumu 15:00'e alabilir miyiz?",
                    lastMessageDirection = "in",
                    unread = true,
                    windowOpen = true,
                    windowExpiresAt = ago(RECENT_MINUTES).plus(1, ChronoUnit.DAYS),
                ),
                Conversation(
                    id = CLOSED_WINDOW_ID,
                    phone = "+905559998877",
                    status = ConversationStatus.Open,
                    lastMessageAt = ago(MINUTES_30H),
                    lastMessagePreview = "Merhaba, hangi hizmet için bilgi istersiniz?",
                    lastMessageDirection = "out",
                    unread = false,
                    windowOpen = false,
                    windowExpiresAt = ago(MINUTES_31H).plus(1, ChronoUnit.DAYS),
                ),
                Conversation(
                    id = ARCHIVED_ID,
                    phone = "+905337654321",
                    customer = ConversationCustomer(MEHMET.id, MEHMET.fullName),
                    status = ConversationStatus.Closed,
                    lastMessageAt = ago(MINUTES_50H),
                    lastMessagePreview = "Teşekkürler, görüşmek üzere.",
                    lastMessageDirection = "in",
                    unread = false,
                    windowOpen = false,
                    windowExpiresAt = ago(MINUTES_50H).plus(1, ChronoUnit.DAYS),
                ),
            )

        threads[OPEN_ID] =
            mutableListOf(
                inbound("m-1", "Merhaba, randevum için yazıyorum.", ago(MINUTES_26H)),
                ConversationMessage(
                    id = "m-2",
                    direction = "out",
                    type = "template",
                    body = "Sayın Ayşe Yılmaz, yarın 11:00 randevunuzu hatırlatırız.",
                    createdAt = ago(MINUTES_20H),
                    status = MessageStatus.Read,
                    event = "appointment_reminder",
                ),
                inbound("m-3", "Yarınki randevumu 15:00'e alabilir miyiz?", ago(RECENT_MINUTES)),
            )
        threads[CLOSED_WINDOW_ID] =
            mutableListOf(
                inbound("m-4", "Merhaba, fiyat bilgisi alabilir miyim?", ago(MINUTES_31H)),
                staff(
                    "m-5",
                    "Merhaba, hangi hizmet için bilgi istersiniz?",
                    ago(MINUTES_30H),
                    MessageStatus.Failed,
                    "Alıcı bir WhatsApp kullanıcısı değil",
                ),
            )
        threads[ARCHIVED_ID] =
            mutableListOf(
                staff("m-6", "Randevunuz 14:00'e alındı.", ago(MINUTES_51H), MessageStatus.Read),
                inbound("m-7", "Teşekkürler, görüşmek üzere.", ago(MINUTES_50H)),
            )
    }

    private fun inbound(
        id: String,
        body: String,
        at: Instant,
    ) = ConversationMessage(id = id, direction = "in", type = "text", body = body, createdAt = at)

    private fun staff(
        id: String,
        body: String,
        at: Instant,
        status: MessageStatus,
        error: String? = null,
        type: String = "text",
    ) = ConversationMessage(
        id = id,
        direction = "out",
        type = type,
        body = body,
        createdAt = at,
        status = status,
        event = "staff_reply",
        sentByName = STAFF_NAME,
        errorDetail = error,
    )

    private suspend fun settle() {
        if (latencyEnabled) delay(LATENCY_MILLIS)
        if (failing) throw ApiError.Network()
    }

    private fun record(id: String): Conversation =
        records.firstOrNull { it.id == id } ?: throw MockErrors.notFound("Sohbet")

    private fun replace(conversation: Conversation) {
        val index = records.indexOfFirst { it.id == conversation.id }
        if (index >= 0) records[index] = conversation
    }

    override suspend fun conversations(
        filter: ConversationFilter,
        cursor: String?,
        limit: Int?,
    ): Page<Conversation> {
        settle()
        val matching = records.filter(filter::matches).sortedByDescending { it.lastMessageAt }
        val start = cursor?.toIntOrNull() ?: 0
        val page = matching.drop(start).take(limit ?: DEFAULT_LIMIT)
        val next = start + page.size
        val hasMore = next < matching.size
        return Page(page, PageInfo(nextCursor = if (hasMore) next.toString() else null, hasMore = hasMore))
    }

    override suspend fun unreadCount(): Int {
        settle()
        return records.count { it.status == ConversationStatus.Open && it.unread }
    }

    override suspend fun conversation(id: String): ConversationDetail {
        settle()
        detailRequestCount++
        return ConversationDetail(record(id), threads[id].orEmpty().toList())
    }

    override suspend fun send(
        conversationId: String,
        body: String,
    ): ConversationMessage {
        settle()
        val conversation = record(conversationId)
        val trimmed = body.trim()
        if (trimmed.isEmpty()) throw MockErrors.validation("body", "Mesaj boş olamaz")
        if (!conversation.windowOpen) {
            throw MockErrors.problem(
                ApiErrorCode.WHATSAPP_WINDOW_CLOSED,
                "Müşterinin son mesajının üzerinden 24 saat geçti",
                MockErrors.HTTP_UNPROCESSABLE,
            )
        }
        return append(conversation, trimmed, "text")
    }

    override suspend fun templateOptions(conversationId: String): List<ConversationTemplateOption> {
        settle()
        val conversation = record(conversationId)
        // Öneri sunucudaki gibi: bağlı müşterinin adı, yoksa boş.
        return templates.map { option ->
            val index = option.variableNames.indexOf("customerName")
            if (index < 0) {
                option
            } else {
                option.copy(
                    suggestedParameters =
                        option.suggestedParameters.toMutableList().also {
                            it[index] = conversation.customer?.fullName.orEmpty()
                        },
                )
            }
        }
    }

    override suspend fun sendTemplate(
        conversationId: String,
        templateName: String,
        language: String,
        parameters: List<String>,
    ): ConversationMessage {
        settle()
        val conversation = record(conversationId)
        val template =
            templates.firstOrNull { it.name == templateName && it.language == language }
                ?: throw MockErrors.problem(
                    ApiErrorCode.WHATSAPP_TEMPLATE_NOT_APPROVED,
                    "Bu şablon sohbetten gönderilemez",
                    MockErrors.HTTP_UNPROCESSABLE,
                )
        if (!template.isComplete(parameters)) throw MockErrors.validation("parameters", "Şablon parametreleri eksik")
        return append(conversation, template.render(parameters), "template")
    }

    override suspend fun markRead(conversationId: String) {
        settle()
        replace(record(conversationId).copy(unread = false))
    }

    override suspend fun setClosed(
        conversationId: String,
        closed: Boolean,
    ): Conversation {
        settle()
        val current = record(conversationId)
        val updated =
            current.copy(
                status = if (closed) ConversationStatus.Closed else ConversationStatus.Open,
                unread = if (closed) false else current.unread,
            )
        replace(updated)
        return updated
    }

    override suspend fun linkCustomer(
        conversationId: String,
        customerId: String,
    ): Conversation {
        settle()
        val customer = MockCustomers.ALL.firstOrNull { it.id == customerId } ?: throw MockErrors.notFound("Müşteri")
        val updated = record(conversationId).copy(customer = ConversationCustomer(customer.id, customer.fullName))
        replace(updated)
        return updated
    }

    private fun append(
        conversation: Conversation,
        body: String,
        type: String,
    ): ConversationMessage {
        val message = staff(UUID.randomUUID().toString(), body, now(), MessageStatus.Sent, type = type)
        threads.getOrPut(conversation.id) { mutableListOf() } += message
        replace(conversation.afterOutgoing(message))
        return message
    }

    companion object {
        const val OPEN_ID = "c0000000-0000-4000-8000-000000000001"
        const val CLOSED_WINDOW_ID = "c0000000-0000-4000-8000-000000000002"
        const val ARCHIVED_ID = "c0000000-0000-4000-8000-000000000003"

        private val AYSE = MockCustomers.ALL.first { it.fullName == "Ayşe Yılmaz" }
        private val MEHMET = MockCustomers.ALL.first { it.fullName != "Ayşe Yılmaz" }
        private const val STAFF_NAME = "Elif Kaya"
        private const val LATENCY_MILLIS = 300L
        private const val RECENT_MINUTES = 4L
        private const val DEFAULT_LIMIT = 50
        private const val MINUTES_20H = 20 * 60L
        private const val MINUTES_26H = 26 * 60L
        private const val MINUTES_30H = 30 * 60L
        private const val MINUTES_31H = 31 * 60L
        private const val MINUTES_50H = 50 * 60L
        private const val MINUTES_51H = 51 * 60L
    }
}
