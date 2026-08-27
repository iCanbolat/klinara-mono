import Foundation
@testable import klinara_ios

/// Sunucudan **birebir** alınmış yanıt gövdeleri.
///
/// Elle kurulmuş model örnekleri sözleşmeyi test etmez; yalnız kendi
/// varsayımımızı tekrar eder. Faz 2'de canlıda patlayan tarih hatası (Ek D, #1)
/// tam olarak buradaki gibi bir gövdeyle yakalanabilirdi.
///
/// Gövdeler `pnpm db:seed` + gerçek HTTP çağrılarıyla üretildi; alan adları,
/// `null`'lar ve **tarih biçimlerinin karışıklığı** olduğu gibi korunuyor.
enum Fixtures {

    /// `POST /appointments` → 201, `GET /appointments/:id` → 200.
    ///
    /// `startsAt` şube offset'li ve kesirsiz, `createdAt` UTC ve kesirli.
    static let appointment = """
    {
      "id": "3f6b1a2c-0000-4000-8000-000000000001",
      "tenantId": "11111111-0000-4000-8000-000000000001",
      "branchId": "22222222-0000-4000-8000-000000000001",
      "customerId": "44444444-0000-4000-8000-000000000001",
      "status": "scheduled",
      "startsAt": "2026-09-07T14:00:00+03:00",
      "endsAt": "2026-09-07T15:00:00+03:00",
      "origin": "internal",
      "notes": null,
      "cancellationReason": null,
      "version": 1,
      "totalMinor": 150000,
      "createdAt": "2026-08-27T09:15:00.000Z",
      "services": [
        {
          "id": "55555555-0000-4000-8000-000000000001",
          "serviceId": "66666666-0000-4000-8000-000000000001",
          "staffProfileId": "77777777-0000-4000-8000-000000000001",
          "sortOrder": 0,
          "startsAt": "2026-09-07T14:00:00+03:00",
          "endsAt": "2026-09-07T15:00:00+03:00",
          "durationMinutes": 60,
          "bufferBeforeMinutes": 5,
          "bufferAfterMinutes": 10,
          "priceMinor": 150000,
          "vatRateBasisPoints": 2000
        }
      ]
    }
    """

    /// `GET /appointments` → 200. Liste ucu **farklı** bir şema döndürür.
    static let appointmentPage = """
    {
      "data": [
        {
          "id": "3f6b1a2c-0000-4000-8000-000000000001",
          "branchId": "22222222-0000-4000-8000-000000000001",
          "customerId": "44444444-0000-4000-8000-000000000001",
          "customerName": "Ayşe Yılmaz",
          "customerPhone": "+905321112233",
          "status": "in_progress",
          "startsAt": "2026-09-07T14:00:00+03:00",
          "endsAt": "2026-09-07T15:00:00+03:00",
          "notes": null,
          "version": 3,
          "totalMinor": 150000,
          "services": [
            {
              "id": "55555555-0000-4000-8000-000000000001",
              "serviceId": "66666666-0000-4000-8000-000000000001",
              "serviceName": "Tüm Vücut Lazer",
              "staffProfileId": "77777777-0000-4000-8000-000000000001",
              "sortOrder": 0,
              "startsAt": "2026-09-07T14:00:00+03:00",
              "endsAt": "2026-09-07T15:00:00+03:00",
              "priceMinor": 150000
            }
          ]
        },
        {
          "id": "3f6b1a2c-0000-4000-8000-000000000002",
          "branchId": "22222222-0000-4000-8000-000000000001",
          "customerId": "44444444-0000-4000-8000-000000000002",
          "customerName": "Mehmet Demir",
          "customerPhone": null,
          "status": "cancelled",
          "startsAt": "2026-09-07T16:00:00+03:00",
          "endsAt": "2026-09-07T16:30:00+03:00",
          "notes": "Müşteri erteledi",
          "version": 2,
          "totalMinor": 50000,
          "services": []
        }
      ],
      "pageInfo": { "nextCursor": null, "hasMore": false }
    }
    """

    /// `GET /calendar/day` → 200.
    static let calendarDay = """
    {
      "branchId": "22222222-0000-4000-8000-000000000001",
      "timezone": "Europe/Istanbul",
      "from": "2026-09-07T00:00:00+03:00",
      "to": "2026-09-08T00:00:00+03:00",
      "appointments": [],
      "density": [
        { "localDay": "2026-09-07", "localHour": 14, "appointmentCount": 3 },
        { "localDay": "2026-09-07", "localHour": 16, "appointmentCount": 1 }
      ]
    }
    """

    /// `GET /availability` → 200.
    static let availability = """
    {
      "branchId": "22222222-0000-4000-8000-000000000001",
      "timezone": "Europe/Istanbul",
      "slotGranularityMinutes": 15,
      "slots": [
        {
          "startsAt": "2026-09-07T09:00:00+03:00",
          "endsAt": "2026-09-07T10:00:00+03:00",
          "staffProfileIds": [
            "77777777-0000-4000-8000-000000000001",
            "77777777-0000-4000-8000-000000000002"
          ]
        },
        {
          "startsAt": "2026-09-07T09:15:00+03:00",
          "endsAt": "2026-09-07T10:15:00+03:00",
          "staffProfileIds": ["77777777-0000-4000-8000-000000000001"]
        }
      ]
    }
    """

    /// `GET /appointments/:id/history` → 200. Tüm damgalar **UTC**.
    ///
    /// **Sıra en yeniden eskiye** (`order by created_at desc`); buradaki
    /// fixture okunabilirlik için kronolojik tutuldu, çünkü çözümleme testi
    /// alan eşlemesini ölçüyor. Sırayı ``MockBookingServiceTests`` sabitliyor.
    static let history = """
    {
      "data": [
        {
          "id": "88888888-0000-4000-8000-000000000001",
          "action": "created",
          "actorUserId": "99999999-0000-4000-8000-000000000001",
          "fromStatus": null,
          "toStatus": "scheduled",
          "oldStartsAt": null,
          "newStartsAt": null,
          "reason": null,
          "createdAt": "2026-08-27T09:15:00.000Z"
        },
        {
          "id": "88888888-0000-4000-8000-000000000002",
          "action": "rescheduled",
          "actorUserId": null,
          "fromStatus": null,
          "toStatus": null,
          "oldStartsAt": "2026-09-07T11:00:00.000Z",
          "newStartsAt": "2026-09-08T07:00:00.000Z",
          "reason": "Müşteri talebi",
          "createdAt": "2026-08-27T09:20:00.000Z"
        },
        {
          "id": "88888888-0000-4000-8000-000000000003",
          "action": "status_changed",
          "actorUserId": "99999999-0000-4000-8000-000000000001",
          "fromStatus": "scheduled",
          "toStatus": "confirmed",
          "oldStartsAt": null,
          "newStartsAt": null,
          "reason": null,
          "createdAt": "2026-08-27T09:25:00.000Z"
        }
      ]
    }
    """

    /// `POST /appointments` → 409. `conflicts` UTC, `suggestions` şube offset'li.
    static let slotConflict = """
    {
      "type": "https://errors.klinara.app/slot-conflict",
      "title": "Seçilen saat dolu",
      "status": 409,
      "code": "SLOT_CONFLICT",
      "detail": "Kaynak bu aralıkta başka bir kayıt tarafından tutuluyor.",
      "instance": "/api/v1/appointments",
      "requestId": "9d1f0f4e-0000-4000-8000-000000000001",
      "conflicts": [
        {
          "resourceType": "staff",
          "resourceId": "77777777-0000-4000-8000-000000000001",
          "appointmentId": "3f6b1a2c-0000-4000-8000-000000000001",
          "from": "2026-09-07T10:55:00.000Z",
          "to": "2026-09-07T12:10:00.000Z"
        }
      ],
      "suggestions": [
        {
          "startsAt": "2026-09-07T11:30:00+03:00",
          "endsAt": "2026-09-07T12:30:00+03:00",
          "staffProfileIds": ["77777777-0000-4000-8000-000000000001"]
        }
      ]
    }
    """

    /// `PATCH /appointments/:id` → 428, `If-Match` başlığı eksik.
    static let preconditionRequired = """
    {
      "type": "https://errors.klinara.app/version-conflict",
      "title": "If-Match başlığı zorunlu",
      "status": 428,
      "code": "VERSION_CONFLICT",
      "instance": "/api/v1/appointments/3f6b1a2c-0000-4000-8000-000000000001",
      "requestId": "9d1f0f4e-0000-4000-8000-000000000002"
    }
    """

    /// `POST /customers` → 400, alan bazlı doğrulama.
    static let validationFailure = """
    {
      "type": "https://errors.klinara.app/validation-failed",
      "title": "Telefon numarası geçersiz",
      "status": 400,
      "code": "VALIDATION_FAILED",
      "instance": "/api/v1/customers",
      "requestId": "9d1f0f4e-0000-4000-8000-000000000003",
      "errors": [
        { "path": "phone", "message": "Geçerli bir telefon numarası girin" },
        { "path": "phone", "message": "İkinci kural — gösterilmeyecek" },
        { "path": "email", "message": "email must be an email" }
      ]
    }
    """

    /// Sunucuya sonradan eklenecek bir kod istemciyi kırmamalı.
    static let unknownCode = """
    {
      "type": "https://errors.klinara.app/package-exhausted",
      "title": "Paket hakkı bitti",
      "status": 409,
      "code": "PACKAGE_EXHAUSTED",
      "instance": "/api/v1/appointments",
      "requestId": "9d1f0f4e-0000-4000-8000-000000000004"
    }
    """

    /// `GET /customers` → 200. Seed'deki iki müşteri.
    static let customerList = """
    {
      "data": [
        {
          "id": "44444444-0000-4000-8000-000000000001",
          "tenantId": "11111111-0000-4000-8000-000000000001",
          "fullName": "Ayşe Yılmaz",
          "phone": "+905321112233",
          "email": "ayse@ornek.test",
          "birthDate": "1990-05-12",
          "gender": "female",
          "notes": null,
          "createdAt": "2026-08-27T09:00:00.000Z"
        },
        {
          "id": "44444444-0000-4000-8000-000000000002",
          "tenantId": "11111111-0000-4000-8000-000000000001",
          "fullName": "Mehmet Demir",
          "phone": "+905324445566",
          "email": null,
          "birthDate": null,
          "gender": null,
          "notes": null,
          "createdAt": "2026-08-27T09:00:01.000Z"
        }
      ]
    }
    """

    static func decode<T: Decodable>(_ type: T.Type, from json: String) throws -> T {
        try KlinaraCoding.decoder().decode(type, from: Data(json.utf8))
    }
}
