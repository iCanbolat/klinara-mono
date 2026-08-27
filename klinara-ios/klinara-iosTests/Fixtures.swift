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

    /// `GET /customers` → 200, `data` zarfıyla.
    ///
    /// Batch 4.1'den sonra sunucu `tags`, adres alanları, `source` ve
    /// `mergedIntoCustomerId`i DAİMA gönderiyor; eski (dar) gövde artık
    /// üretilmiyor ve fixture da onu taklit etmemeli.
    static let customerList = """
    {
      "data": [
        {
          "id": "2406e143-3124-45a6-a42a-513dd78ac527",
          "tenantId": "056dbca8-550a-4b6a-b46f-96421bbbe635",
          "fullName": "Ayşe Yılmaz",
          "phone": "+905321112233",
          "email": "ayse@ornek.test",
          "birthDate": "1990-05-12",
          "gender": "female",
          "notes": null,
          "addressLine": "Bağdat Cad. No: 120 D: 5",
          "district": "Kadıköy",
          "city": "İstanbul",
          "postalCode": "34710",
          "source": "instagram",
          "mergedIntoCustomerId": null,
          "tags": [
            {
              "id": "6b20f728-8ed1-4a7d-9958-ee051e937bb8",
              "name": "VIP",
              "color": "#c0392b"
            }
          ],
          "createdAt": "2026-08-26T22:56:47.415Z"
        },
        {
          "id": "b14d64d8-f40f-4ef8-a644-75ac38f3f146",
          "tenantId": "056dbca8-550a-4b6a-b46f-96421bbbe635",
          "fullName": "Mehmet Demir",
          "phone": "+905324445566",
          "email": null,
          "birthDate": null,
          "gender": null,
          "notes": null,
          "addressLine": null,
          "district": null,
          "city": null,
          "postalCode": null,
          "source": null,
          "mergedIntoCustomerId": null,
          "tags": [
            {
              "id": "6b20f728-8ed1-4a7d-9958-ee051e937bb8",
              "name": "VIP",
              "color": "#c0392b"
            }
          ],
          "createdAt": "2026-08-26T22:56:47.415Z"
        }
      ]
    }
    """

    /// `PUT /customers/:id/tags` → 200. Etiketli müşteri kartı (Batch 4.1).
    static let customerWithTags = """
    {
      "id": "b14d64d8-f40f-4ef8-a644-75ac38f3f146",
      "tenantId": "056dbca8-550a-4b6a-b46f-96421bbbe635",
      "fullName": "Mehmet Demir",
      "phone": "+905324445566",
      "email": null,
      "birthDate": null,
      "gender": null,
      "notes": null,
      "addressLine": null,
      "district": null,
      "city": null,
      "postalCode": null,
      "source": null,
      "mergedIntoCustomerId": null,
      "tags": [
        {
          "id": "6b20f728-8ed1-4a7d-9958-ee051e937bb8",
          "name": "VIP",
          "color": "#c0392b"
        }
      ],
      "createdAt": "2026-08-26T22:56:47.415Z"
    }
    """

    /// `GET /customers?limit=1` → 200. Cursor sayfalaması — `nextCursor` opak.
    static let customerPage = """
    {
      "data": [
        {
          "id": "b14d64d8-f40f-4ef8-a644-75ac38f3f146",
          "tenantId": "056dbca8-550a-4b6a-b46f-96421bbbe635",
          "fullName": "Mehmet Demir",
          "phone": "+905324445566",
          "email": null,
          "birthDate": null,
          "gender": null,
          "notes": null,
          "addressLine": null,
          "district": null,
          "city": null,
          "postalCode": null,
          "source": null,
          "mergedIntoCustomerId": null,
          "tags": [
            {
              "id": "6b20f728-8ed1-4a7d-9958-ee051e937bb8",
              "name": "VIP",
              "color": "#c0392b"
            }
          ],
          "createdAt": "2026-08-26T22:56:47.415Z"
        }
      ],
      "pageInfo": {
        "hasMore": true,
        "nextCursor": "MjAyNi0wOC0yNlQyMjo1Njo0Ny40MTVafGIxNGQ2NGQ4LWY0MGYtNGVmOC1hNjQ0LTc1YWMzOGYzZjE0Ng"
      }
    }
    """

    /// `GET /customers/search?q=yılmaz` → 200.
    ///
    /// Gövde **çıplak dizi**dir — `data` zarfı YOK. Diğer liste uçlarından
    /// ayrılan tek yer burası; istemci onu zarf sanarsa arama her çağrıda
    /// çözümleme hatası verir.
    static let customerSearch = """
    [
      {
        "id": "2406e143-3124-45a6-a42a-513dd78ac527",
        "tenantId": "056dbca8-550a-4b6a-b46f-96421bbbe635",
        "fullName": "Ayşe Yılmaz",
        "phone": "+905321112233",
        "email": "ayse@ornek.test",
        "birthDate": "1990-05-12",
        "gender": "female",
        "notes": null,
        "addressLine": "Bağdat Cad. No: 120 D: 5",
        "district": "Kadıköy",
        "city": "İstanbul",
        "postalCode": "34710",
        "source": "instagram",
        "mergedIntoCustomerId": null,
        "tags": [
          {
            "id": "6b20f728-8ed1-4a7d-9958-ee051e937bb8",
            "name": "VIP",
            "color": "#c0392b"
          }
        ],
        "createdAt": "2026-08-26T22:56:47.415Z"
      }
    ]
    """

    /// `PATCH /notes/:id` → 200. Metin değişti: trigger `version`ı 2 yaptı.
    static let customerNote = """
    {
      "id": "55519900-30b1-4c41-b13e-e16f39101276",
      "customerId": "b14d64d8-f40f-4ef8-a644-75ac38f3f146",
      "appointmentId": null,
      "kind": "treatment",
      "body": "Cilt reaksiyonu gözlenmedi. Kontrol 2 hafta sonra.",
      "customerVisible": false,
      "authorUserId": "491d25b5-e34f-4d12-af6a-0f8660acd22e",
      "version": 2,
      "createdAt": "2026-08-27T18:24:55.179Z",
      "updatedAt": "2026-08-27T18:24:55.232Z"
    }
    """

    /// `GET /notes/:id/revisions` → 200. Gövde düzenlemeden ÖNCEKİ metindir.
    static let noteRevisions = """
    {
      "data": [
        {
          "id": "b99dc6a2-afe6-4cb3-aafe-e9638614b8f8",
          "body": "Cilt reaksiyonu gözlenmedi.",
          "version": 1,
          "editedBy": "491d25b5-e34f-4d12-af6a-0f8660acd22e",
          "editedAt": "2026-08-27T18:24:55.232Z"
        }
      ]
    }
    """

    /// `GET /customers/:id/timeline` → 200. Randevu + not, TEK akış.
    ///
    /// DİKKAT: `occurredAt` UTC (`Z`) ama randevu payload'ındaki `startsAt`
    /// **`+00:00` offset'iyle** geliyor — takvim uçlarındaki şube offset'i
    /// (`+03:00`) DEĞİL. `jsonb_build_object` timestamptz'yi oturumun saat
    /// diliminde (UTC) serileştiriyor. Aynı anı gösterirler; biçim farklıdır.
    static let timelinePage = """
    {
      "data": [
        {
          "kind": "appointment",
          "id": "a52c358e-af07-45bc-b5ac-3b93ff515939",
          "occurredAt": "2026-08-29T07:00:00.000Z",
          "payload": {
            "endsAt": "2026-08-29T07:30:00+00:00",
            "status": "scheduled",
            "branchId": "9effe479-348c-4ce7-97b2-cba5b115132e",
            "startsAt": "2026-08-29T07:00:00+00:00",
            "totalMinor": 50000
          }
        },
        {
          "kind": "note",
          "id": "55519900-30b1-4c41-b13e-e16f39101276",
          "occurredAt": "2026-08-27T18:24:55.179Z",
          "payload": {
            "body": "Cilt reaksiyonu gözlenmedi. Kontrol 2 hafta sonra.",
            "kind": "treatment",
            "authorUserId": "491d25b5-e34f-4d12-af6a-0f8660acd22e",
            "appointmentId": null,
            "customerVisible": false
          }
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `POST /uploads/presign` → 200. İmza kısaltıldı; taşıdığı bilgi şekildir.
    static let presignUpload = """
    {
      "storageKey": "056dbca8-550a-4b6a-b46f-96421bbbe635/b14d64d8-f40f-4ef8-a644-75ac38f3f146/75029161-b130-446c-9b91-42d43de6604a",
      "uploadUrl": "http://localhost:9000/klinara/056dbca8-550a-4b6a-b46f-96421bbbe635/b14d64d8-f40f-4ef8-a644-75ac38f3f146/75029161-b130-446c-9b91-42d43de6604a?X-Amz-Signature=KISALTILDI",
      "contentType": "image/png",
      "expiresAt": "2026-08-27T18:31:58.685Z"
    }
    """

    /// `POST /customers/:id/files` → 201. `hasThumbnail` HENÜZ false:
    /// küçük görsel kuyruk işiyle üretiliyor.
    static let customerFile = """
    {
      "id": "1bed0875-9998-4144-97f4-fffc32087b80",
      "customerId": "b14d64d8-f40f-4ef8-a644-75ac38f3f146",
      "groupId": null,
      "kind": "photo",
      "position": "before",
      "mimeType": "image/png",
      "sizeBytes": 70,
      "sha256": "c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77",
      "hasThumbnail": false,
      "takenAt": null,
      "uploadedBy": "491d25b5-e34f-4d12-af6a-0f8660acd22e",
      "createdAt": "2026-08-27T18:27:07.204Z"
    }
    """

    /// `POST /customers/:id/file-groups` → 201. Yeni grup boş başlar.
    static let fileGroup = """
    {
      "id": "4453c61c-3041-4288-af43-00aa141ea304",
      "title": "Sağ kol — 3. seans",
      "bodyArea": "sağ kol",
      "serviceId": null,
      "files": [],
      "createdAt": "2026-08-27T18:27:07.316Z"
    }
    """

    static func decode<T: Decodable>(_ type: T.Type, from json: String) throws -> T {
        try KlinaraCoding.decoder().decode(type, from: Data(json.utf8))
    }
}
