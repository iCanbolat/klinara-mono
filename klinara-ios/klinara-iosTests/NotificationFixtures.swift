import Foundation
@testable import klinara_ios

/// Faz 8 (bildirim, WhatsApp) yanıt gövdeleri — sunucudan **birebir** yakalandı.
///
/// Gövdeler `apps/api` entegrasyon test altyapısı ayağa kaldırılıp gerçek HTTP
/// uçlarına gidilerek alındı (`test/helpers/app` + gerçek Postgres, Graph API
/// için `test/helpers/whatsapp` mock'u); alan adları, `null`'lar ve tarih
/// biçimleri olduğu gibi duruyor. ``FinanceFixtures`` ile aynı disiplin: elle
/// kurulmuş örnekler sözleşmeyi test etmez, yalnız kendi varsayımımızı
/// tekrar eder.
///
/// **`GET /integrations/whatsapp` yapılandırılmamışken burada YOK**, çünkü
/// gövdesi hiç yazılmıyor: `200` ile BOŞ yanıt. Bir metin sabiti onu temsil
/// edemezdi; testi ``APIClient/sendOptional(_:)`` üzerinden yazılıyor.
extension Fixtures {

    /// `PUT /notification-templates` → 200. Kiracıya ait, kod varsayılanını
    /// ezen bir satır: `id` DOLU, `isDefault` false ve WhatsApp konumsal
    /// değişkenleri gönderildiği SIRADA geri geliyor.
    static let notificationTemplateWhatsApp = """
    {
      "id": "56036745-512f-4608-945c-3c6bb361a9af",
      "event": "appointment_reminder",
      "channel": "whatsapp",
      "locale": "tr",
      "kind": "transactional",
      "subject": null,
      "body": "Sayın {{customerName}}, {{appointmentAt}} randevunuzu hatırlatırız.",
      "whatsappTemplateName": "randevu_hatirlatma",
      "whatsappTemplateLanguage": "tr",
      "whatsappVariables": [
        "customerName",
        "appointmentAt"
      ],
      "isActive": true,
      "isDefault": false,
      "variables": [
        "customerName",
        "appointmentAt"
      ]
    }
    """

    /// Aynı listedeki bir **varsayılan** satır: `id` `null`, `isDefault` true.
    /// İstemcinin `Identifiable` kimliğini `id`'den alamamasının sebebi bu —
    /// on beş satırın on dördü aynı kimliği paylaşırdı.
    static let notificationTemplateDefault = """
    {
      "id": null,
      "event": "appointment_confirmation",
      "channel": "sms",
      "locale": "tr",
      "kind": "transactional",
      "subject": null,
      "body": "Sayın {{customerName}}, {{appointmentAt}} randevunuz oluşturuldu. {{branchName}}",
      "whatsappTemplateName": null,
      "whatsappTemplateLanguage": null,
      "whatsappVariables": [],
      "isActive": true,
      "isDefault": true,
      "variables": [
        "customerName",
        "appointmentAt",
        "branchName"
      ]
    }
    """

    /// E-posta kanalı: `subject` DOLU ve gövde satır sonu içeriyor.
    ///
    /// Gövdedeki `\\n` ÇİFT ters bölü: Swift'in çok satırlı metni `\n`'i
    /// gerçek bir satır sonuna çevirir ve JSON metninin içindeki kaçışsız
    /// satır sonu geçersiz JSON'dur. Yakalanan gövde birebir aynı; yalnız
    /// Swift kaynağına girerken bir kez daha kaçırılıyor.
    static let notificationTemplateEmailDefault = """
    {
      "id": null,
      "event": "appointment_confirmation",
      "channel": "email",
      "locale": "tr",
      "kind": "transactional",
      "subject": "Randevunuz oluşturuldu",
      "body": "Sayın {{customerName}},\\n\\n{{appointmentAt}} tarihindeki {{serviceName}} randevunuz oluşturuldu.\\n\\n{{branchName}}",
      "whatsappTemplateName": null,
      "whatsappTemplateLanguage": null,
      "whatsappVariables": [],
      "isActive": true,
      "isDefault": true,
      "variables": [
        "customerName",
        "appointmentAt",
        "serviceName",
        "branchName"
      ]
    }
    """

    /// `GET /notification-preferences` satırı — sentezlenmiş varsayılan.
    /// Sessiz saat `"HH:MM"`, zaman damgası değil.
    static let notificationPreferenceDefault = """
    {
      "id": null,
      "branchId": null,
      "event": "appointment_cancelled",
      "kind": "transactional",
      "channels": [
        "whatsapp",
        "sms",
        "email"
      ],
      "quietHoursStart": "21:00",
      "quietHoursEnd": "09:00",
      "isDefault": true
    }
    """

    /// `PUT /notification-preferences` → 200. `branchId` `null` = kiracı
    /// varsayılanı; kanal sırası GÖNDERİLDİĞİ gibi geri geliyor.
    static let notificationPreferenceSaved = """
    {
      "id": "5c11e229-1a38-425a-92a2-aee85bb7427f",
      "branchId": null,
      "event": "appointment_reminder",
      "kind": "transactional",
      "channels": [
        "whatsapp",
        "sms"
      ],
      "quietHoursStart": "22:00",
      "quietHoursEnd": "08:00",
      "isDefault": false
    }
    """

    /// `GET /branches/:id/reminder-settings` — şube override'ı YOK, kiracı
    /// ayarı çözülmüş olarak dönüyor.
    static let reminderSettingsTenantDefault = """
    {
      "branchId": "ba90a182-4468-4fea-b5d6-4c8e112770e5",
      "reminderHoursBefore": [
        24,
        2
      ],
      "isBranchOverride": false,
      "noShowFollowupEnabled": true,
      "noShowFollowupDelayHours": 2
    }
    """

    /// `PUT` sonrası aynı uç — `isBranchOverride` artık true.
    static let reminderSettingsBranchOverride = """
    {
      "branchId": "ba90a182-4468-4fea-b5d6-4c8e112770e5",
      "reminderHoursBefore": [
        24,
        4
      ],
      "isBranchOverride": true,
      "noShowFollowupEnabled": true,
      "noShowFollowupDelayHours": 3
    }
    """

    /// `GET /appointments/:id/notifications` — **çıplak dizi**, zarf yok.
    static let appointmentNotifications = """
    [
      {
        "id": "c0ad11b7-7117-40cc-a244-36e40f252f28",
        "event": "appointment_reminder",
        "offsetHours": 24,
        "scheduledFor": "2026-09-10T09:00:00.000Z",
        "status": "pending",
        "messageId": null
      },
      {
        "id": "74d3ed94-8417-454f-9337-fd4ff0f52d5d",
        "event": "appointment_reminder",
        "offsetHours": 4,
        "scheduledFor": "2026-09-11T05:00:00.000Z",
        "status": "pending",
        "messageId": null
      }
    ]
    """

    /// `GET /messages?limit=1` → `{ data, pageInfo }`. `to` MASKELİ; ham
    /// adres sunucuda da saklanmıyor. `attempt: 0` + `queued`: mesaj üretildi
    /// ama henüz denenmedi.
    static let messagePage = """
    {
      "data": [
        {
          "id": "cde431f8-13be-4a88-9303-dd27b369f570",
          "customerId": "070b8993-8adf-44ab-852d-123b5e72dcc2",
          "userId": null,
          "channel": "sms",
          "event": "appointment_reminder",
          "status": "queued",
          "to": "+90********67",
          "subject": null,
          "body": "Sayın Ayşe Yılmaz, 7 Eylül 14:00 randevunuzu hatırlatırız. Merkez",
          "errorCode": null,
          "attempt": 0,
          "scheduledFor": "2026-08-29T05:00:00.000Z",
          "sentAt": null,
          "deliveredAt": null,
          "createdAt": "2026-08-28T22:36:45.305Z"
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `POST /customers/:id/opt-out` → 201. `channel: null` TÜM kanallar
    /// demek; `kind` sunucuda sabit `marketing`.
    static let optOutRecord = """
    {
      "id": "0cc636e1-59e6-4cb1-b215-c5a7dbd082d6",
      "customerId": "070b8993-8adf-44ab-852d-123b5e72dcc2",
      "channel": null,
      "kind": "marketing",
      "source": "customer_request",
      "createdAt": "2026-08-28T22:36:45.328Z"
    }
    """

    /// `GET /integrations/whatsapp` — doğrulanmış hesap. Ham token yanıtta
    /// YOK; yalnız maskeli hâli var.
    static let whatsappAccountActive = """
    {
      "wabaId": "1029384756",
      "phoneNumberId": "5647382910",
      "businessPhone": "+902121234567",
      "apiVersion": "v21.0",
      "status": "active",
      "accessTokenMasked": "••••••••a91f",
      "hasAppSecret": true,
      "lastVerifiedAt": "2026-08-28T22:36:45.178Z",
      "lastError": null
    }
    """

    /// `GET /integrations/whatsapp/templates` — Meta'dan senkronlanan
    /// şablonlar. `status` sunucuda küçük harfe çevriliyor (`APPROVED` →
    /// `approved`).
    static let whatsappTemplates = """
    [
      {
        "name": "randevu_hatirlatma",
        "language": "tr",
        "category": "UTILITY",
        "status": "approved",
        "bodyVariableCount": 2,
        "buttons": [
          {
            "text": "Onayla",
            "type": "QUICK_REPLY"
          },
          {
            "text": "İptal Et",
            "type": "QUICK_REPLY"
          }
        ],
        "syncedAt": "2026-08-28T22:36:45.177Z"
      }
    ]
    """

    /// `POST /integrations/whatsapp/verify` → 200.
    static let whatsappVerifyResult = """
    {
      "ok": true,
      "error": null,
      "templateCount": 1
    }
    """

    /// `PUT /notification-templates` → 422. `detail` izinli değişkenleri
    /// sayıyor; ``APIError/displayMessage`` bu yüzden genel bir cümle yerine
    /// `detail`i gösteriyor.
    static let templateInvalidProblem = """
    {
      "type": "https://errors.klinara.app/template-invalid",
      "title": "Bu olayda tanımlı olmayan değişken: musteriAdi",
      "status": 422,
      "code": "TEMPLATE_INVALID",
      "instance": "/api/v1/notification-templates",
      "requestId": "2cff67c7-6a2f-45a8-9132-dc935f387656",
      "detail": "Kullanılabilir değişkenler: customerName, branchName, appointmentAt, serviceName"
    }
    """

    /// `PUT /notification-preferences` → 422: sessiz saatin yalnız bir ucu
    /// gönderildi.
    static let quietHoursProblem = """
    {
      "type": "https://errors.klinara.app/validation-failed",
      "title": "Sessiz saat başlangıcı ve bitişi birlikte verilmeli",
      "status": 422,
      "code": "VALIDATION_FAILED",
      "instance": "/api/v1/notification-preferences",
      "requestId": "25fd73e0-5ada-443f-8037-b06930b204d2"
    }
    """
}
