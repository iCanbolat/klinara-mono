import Foundation
@testable import klinara_ios

/// Sohbet uçlarının yanıt gövdeleri — sunucudan **birebir** yakalandı.
///
/// `apps/api` entegrasyon test altyapısıyla (gerçek Postgres, Graph API için
/// `test/helpers/whatsapp` mock'u) alındı; aynı JSON `klinara-fixtures/conversations/`
/// altında Android'in de okuduğu dosyalar olarak duruyor.
extension Fixtures {

    /// `list-page.json`
    static let conversationListPage = """
    {
      "data": [
        {
          "id": "30aba20b-a68e-442a-948a-98a4e5985e33",
          "phone": "+905559998877",
          "customer": null,
          "status": "open",
          "lastMessageAt": "2026-09-22T10:31:38.690Z",
          "lastMessagePreview": "Merhaba",
          "lastMessageDirection": "out",
          "unread": false,
          "windowOpen": true,
          "windowExpiresAt": "2026-09-23T10:31:38.000Z"
        }
      ],
      "pageInfo": {
        "hasMore": true,
        "nextCursor": "MjAyNi0wOS0yMlQxMDozMTozOC42OTBafDMwYWJhMjBiLWE2OGUtNDQyYS05NDhhLTk4YTRlNTk4NWUzMw"
      }
    }
    """

    /// `detail-window-closed.json`
    static let conversationDetailWindowClosed = """
    {
      "conversation": {
        "id": "91088f97-9ffe-417e-ac20-4b05e086485c",
        "phone": "+905321234567",
        "customer": {
          "id": "6fb15a2d-d2df-43ca-903f-6e3164bf88c0",
          "fullName": "Ayşe Yılmaz"
        },
        "status": "open",
        "lastMessageAt": "2026-09-22T10:31:38.780Z",
        "lastMessagePreview": "Merhaba Ayşe Yılmaz, bugünkü randevunuza gelemediğinizi gördük. Yeni bir randevu için Nişantaşı şubemize bu mesajı yanıtlayarak ulaşabilirsiniz.",
        "lastMessageDirection": "out",
        "unread": false,
        "windowOpen": false,
        "windowExpiresAt": "2026-09-22T09:31:38.740Z"
      },
      "messages": [
        {
          "id": "9b0360b5-6598-454d-b40f-e547a27c580a",
          "direction": "in",
          "type": "text",
          "body": "Merhaba, yarınki randevumu değiştirebilir miyim?",
          "createdAt": "2026-09-22T10:31:38.000Z",
          "status": null,
          "event": null,
          "sentByName": null,
          "errorDetail": null,
          "appointmentId": null
        },
        {
          "id": "87de0c9b-af01-491f-836b-325b8ac8870b",
          "direction": "out",
          "type": "text",
          "body": "Tabii, hangi saat uygun?",
          "createdAt": "2026-09-22T10:31:38.644Z",
          "status": "sent",
          "event": "staff_reply",
          "sentByName": "Klinik Sahibi",
          "errorDetail": null,
          "appointmentId": null
        },
        {
          "id": "0e8f4419-7f7e-4fe2-b4b3-2de349f325d3",
          "direction": "out",
          "type": "template",
          "body": "Merhaba Ayşe Yılmaz, bugünkü randevunuza gelemediğinizi gördük. Yeni bir randevu için Nişantaşı şubemize bu mesajı yanıtlayarak ulaşabilirsiniz.",
          "createdAt": "2026-09-22T10:31:38.780Z",
          "status": "sent",
          "event": "staff_reply",
          "sentByName": "Klinik Sahibi",
          "errorDetail": null,
          "appointmentId": null
        }
      ]
    }
    """

    /// `template-options.json`
    static let conversationTemplateOptions = """
    [
      {
        "name": "klinara_gelmedi_takip",
        "language": "tr",
        "category": "UTILITY",
        "bodyText": "Merhaba {{1}}, bugünkü randevunuza gelemediğinizi gördük. Yeni bir randevu için {{2}} şubemize bu mesajı yanıtlayarak ulaşabilirsiniz.",
        "bodyVariableCount": 2,
        "variableNames": [
          "customerName",
          "branchName"
        ],
        "suggestedParameters": [
          "Ayşe Yılmaz",
          "Merkez Şube"
        ]
      },
      {
        "name": "klinik_bilgilendirme",
        "language": "tr",
        "category": "UTILITY",
        "bodyText": "Bilgilendirme: {{1}}",
        "bodyVariableCount": 1,
        "variableNames": [
          null
        ],
        "suggestedParameters": [
          ""
        ]
      }
    ]
    """

    /// `template-sent.json`
    static let conversationTemplateSent = """
    {
      "id": "0e8f4419-7f7e-4fe2-b4b3-2de349f325d3",
      "direction": "out",
      "type": "template",
      "body": "Merhaba Ayşe Yılmaz, bugünkü randevunuza gelemediğinizi gördük. Yeni bir randevu için Nişantaşı şubemize bu mesajı yanıtlayarak ulaşabilirsiniz.",
      "createdAt": "2026-09-22T10:31:38.780Z",
      "status": "sent",
      "event": "staff_reply",
      "sentByName": "Klinik Sahibi",
      "errorDetail": null,
      "appointmentId": null
    }
    """

    /// `message-failed.json`
    static let conversationMessageFailed = """
    {
      "id": "171269b8-a4a6-4457-87c7-d29d7b9046b8",
      "direction": "out",
      "type": "text",
      "body": "Merhaba",
      "createdAt": "2026-09-22T10:31:38.690Z",
      "status": "failed",
      "event": "staff_reply",
      "sentByName": "Klinik Sahibi",
      "errorDetail": "Recipient is not a WhatsApp user",
      "appointmentId": null
    }
    """

    /// `window-closed-problem.json`
    static let conversationWindowClosedProblem = """
    {
      "type": "https://errors.klinara.app/whatsapp-window-closed",
      "title": "Müşterinin son mesajının üzerinden 24 saat geçti; WhatsApp yalnız onaylı şablon gönderimine izin veriyor",
      "status": 422,
      "code": "WHATSAPP_WINDOW_CLOSED",
      "instance": "/api/v1/conversations/91088f97-9ffe-417e-ac20-4b05e086485c/messages",
      "requestId": "46495018-c716-49dc-90bc-e72ada74a7a9"
    }
    """

    /// `unread-count.json`
    static let conversationUnreadCount = """
    {
      "count": 0
    }
    """
}
