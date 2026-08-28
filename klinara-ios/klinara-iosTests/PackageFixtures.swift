import Foundation
@testable import klinara_ios

/// Faz 5 (paket) yanıt gövdeleri — sunucudan **birebir** yakalandı.
///
/// Gövdeler `apps/api` entegrasyon test altyapısı ayağa kaldırılıp gerçek HTTP
/// uçlarına gidilerek alındı; alan adları, `null`'lar ve tarih biçimleri
/// olduğu gibi duruyor. Elle kurulmuş örnekler sözleşmeyi test etmez, yalnız
/// kendi varsayımımızı tekrar eder.
extension Fixtures {

    /// `GET /package-definitions/:id` → 200.
    ///
    /// Çok kalemli. Bu örnekte satış fiyatı kalemlerin katalog toplamından
    /// **yüksek** (1.200.000 > 800.000) — yani indirim yok; ekranın üstü
    /// çizili liste fiyatını göstermemesi gerektiği durum.
    /// `branchId` **tüm şubeler** anlamında `null`, `deletedAt` de `null`.
    static let packageDefinition = """
    {
      "id": "c3f53244-1b81-4bfb-9133-03ecf9654c4e",
      "branchId": null,
      "slug": "lazer-10-seans",
      "name": "10 Seans Lazer + 2 Bakim",
      "description": null,
      "totalPriceMinor": 1200000,
      "listPriceMinor": 800000,
      "currency": "TRY",
      "validityDays": 365,
      "isTransferable": true,
      "isOnlineSellable": false,
      "isActive": true,
      "revision": 1,
      "version": 1,
      "items": [
        {
          "id": "af5fa936-38dc-4fb9-9463-4edb455131fc",
          "serviceId": "38b89510-8bbd-4014-a78b-69e62fc239a5",
          "serviceName": "Bölgesel Lazer",
          "quantity": 10,
          "unitListPriceMinor": 50000,
          "sortOrder": 0
        },
        {
          "id": "f2964797-6e65-4e74-a351-56186ca6758d",
          "serviceId": "7589a39b-99a3-41d9-86ac-551db512eced",
          "serviceName": "Tüm Vücut Lazer",
          "quantity": 2,
          "unitListPriceMinor": 150000,
          "sortOrder": 1
        }
      ],
      "createdAt": "2026-08-28T07:50:05.973Z",
      "updatedAt": "2026-08-28T07:50:05.973Z",
      "deletedAt": null
    }
    """

    /// `GET /package-definitions` → 200, cursor sayfalı zarf.
    static let packageDefinitionPage = """
    {
      "data": [
        {
          "id": "c3f53244-1b81-4bfb-9133-03ecf9654c4e",
          "branchId": null,
          "slug": "lazer-10-seans",
          "name": "10 Seans Lazer + 2 Bakim",
          "description": null,
          "totalPriceMinor": 1200000,
          "listPriceMinor": 800000,
          "currency": "TRY",
          "validityDays": 365,
          "isTransferable": true,
          "isOnlineSellable": false,
          "isActive": true,
          "revision": 1,
          "version": 1,
          "items": [
            {
              "id": "af5fa936-38dc-4fb9-9463-4edb455131fc",
              "serviceId": "38b89510-8bbd-4014-a78b-69e62fc239a5",
              "serviceName": "Bölgesel Lazer",
              "quantity": 10,
              "unitListPriceMinor": 50000,
              "sortOrder": 0
            },
            {
              "id": "f2964797-6e65-4e74-a351-56186ca6758d",
              "serviceId": "7589a39b-99a3-41d9-86ac-551db512eced",
              "serviceName": "Tüm Vücut Lazer",
              "quantity": 2,
              "unitListPriceMinor": 150000,
              "sortOrder": 1
            }
          ],
          "createdAt": "2026-08-28T07:50:05.973Z",
          "updatedAt": "2026-08-28T07:50:05.973Z",
          "deletedAt": null
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `GET /customer-packages/:id` → 200.
    ///
    /// Kalemler gömülü; `refundSettlementStatus`, `refundedAt`, `refundReason`
    /// ve `transferredFromPackageId` `null`. Damgalar **UTC ve kesirli**.
    static let customerPackage = """
    {
      "id": "04c1303e-ef53-407c-8be7-51976240b091",
      "customerId": "c4c007f0-1e33-4cb1-be96-2eb4de47f012",
      "branchId": "f14abe4a-b673-4116-8979-c5459fc7a899",
      "definitionId": "c3f53244-1b81-4bfb-9133-03ecf9654c4e",
      "name": "10 Seans Lazer + 2 Bakim",
      "definitionRevision": 1,
      "totalPriceMinor": 1200000,
      "currency": "TRY",
      "isTransferable": true,
      "validityDays": 365,
      "soldAt": "2026-08-28T07:50:06.015Z",
      "expiresAt": "2027-08-28T07:50:06.015Z",
      "status": "active",
      "remainingSessions": 12,
      "outstandingMinor": 1200000,
      "refundedSessions": 0,
      "refundAmountMinor": 0,
      "refundSettlementStatus": null,
      "refundedAt": null,
      "refundReason": null,
      "transferredFromPackageId": null,
      "note": null,
      "version": 3,
      "items": [
        {
          "id": "6323ae6d-7fa0-44c5-92b4-6b7a1f31e39a",
          "serviceId": "38b89510-8bbd-4014-a78b-69e62fc239a5",
          "serviceName": "Bölgesel Lazer",
          "quantityTotal": 10,
          "remainingSessions": 10,
          "unitListPriceMinor": 50000,
          "itemTotalMinor": 750000,
          "outstandingMinor": 750000,
          "sortOrder": 0
        },
        {
          "id": "f0eb3854-ab17-4441-8197-756266fc41ad",
          "serviceId": "7589a39b-99a3-41d9-86ac-551db512eced",
          "serviceName": "Tüm Vücut Lazer",
          "quantityTotal": 2,
          "remainingSessions": 2,
          "unitListPriceMinor": 150000,
          "itemTotalMinor": 450000,
          "outstandingMinor": 450000,
          "sortOrder": 1
        }
      ],
      "createdAt": "2026-08-28T07:50:06.009Z"
    }
    """

    /// `GET /customers/:id/packages` → 200.
    static let customerPackagePage = """
    {
      "data": [
        {
          "id": "04c1303e-ef53-407c-8be7-51976240b091",
          "customerId": "c4c007f0-1e33-4cb1-be96-2eb4de47f012",
          "branchId": "f14abe4a-b673-4116-8979-c5459fc7a899",
          "definitionId": "c3f53244-1b81-4bfb-9133-03ecf9654c4e",
          "name": "10 Seans Lazer + 2 Bakim",
          "definitionRevision": 1,
          "totalPriceMinor": 1200000,
          "currency": "TRY",
          "isTransferable": true,
          "validityDays": 365,
          "soldAt": "2026-08-28T07:50:06.015Z",
          "expiresAt": "2027-08-28T07:50:06.015Z",
          "status": "active",
          "remainingSessions": 12,
          "outstandingMinor": 1200000,
          "refundedSessions": 0,
          "refundAmountMinor": 0,
          "refundSettlementStatus": null,
          "refundedAt": null,
          "refundReason": null,
          "transferredFromPackageId": null,
          "note": null,
          "version": 3,
          "items": [
            {
              "id": "6323ae6d-7fa0-44c5-92b4-6b7a1f31e39a",
              "serviceId": "38b89510-8bbd-4014-a78b-69e62fc239a5",
              "serviceName": "Bölgesel Lazer",
              "quantityTotal": 10,
              "remainingSessions": 10,
              "unitListPriceMinor": 50000,
              "itemTotalMinor": 750000,
              "outstandingMinor": 750000,
              "sortOrder": 0
            },
            {
              "id": "f0eb3854-ab17-4441-8197-756266fc41ad",
              "serviceId": "7589a39b-99a3-41d9-86ac-551db512eced",
              "serviceName": "Tüm Vücut Lazer",
              "quantityTotal": 2,
              "remainingSessions": 2,
              "unitListPriceMinor": 150000,
              "itemTotalMinor": 450000,
              "outstandingMinor": 450000,
              "sortOrder": 1
            }
          ],
          "createdAt": "2026-08-28T07:50:06.009Z"
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `GET /customer-packages/:id/ledger` → 200, yeniden eskiye.
    ///
    /// `purchase` satırları ile bir `manual_adjustment` bir arada; gerekçe
    /// yalnız düzeltmede dolu.
    static let packageLedgerPage = """
    {
      "data": [
        {
          "id": "1a0b3644-cad2-4820-a456-6c4cc67120e3",
          "customerPackageItemId": "6323ae6d-7fa0-44c5-92b4-6b7a1f31e39a",
          "serviceId": "38b89510-8bbd-4014-a78b-69e62fc239a5",
          "serviceName": "Bölgesel Lazer",
          "entryType": "manual_adjustment",
          "delta": -1,
          "appointmentId": null,
          "actorUserId": "8c4ab993-a09d-4357-9928-756a26957790",
          "reason": "fixture icin dusuruldu",
          "reversesEntryId": null,
          "createdAt": "2026-08-28T07:50:06.067Z"
        },
        {
          "id": "d77e67f5-5f6f-4c1a-8be3-9ecfff9bdb61",
          "customerPackageItemId": "f0eb3854-ab17-4441-8197-756266fc41ad",
          "serviceId": "7589a39b-99a3-41d9-86ac-551db512eced",
          "serviceName": "Tüm Vücut Lazer",
          "entryType": "purchase",
          "delta": 2,
          "appointmentId": null,
          "actorUserId": "8c4ab993-a09d-4357-9928-756a26957790",
          "reason": null,
          "reversesEntryId": null,
          "createdAt": "2026-08-28T07:50:06.009Z"
        },
        {
          "id": "7c8f1111-72fd-49c5-9703-7221d53e7166",
          "customerPackageItemId": "6323ae6d-7fa0-44c5-92b4-6b7a1f31e39a",
          "serviceId": "38b89510-8bbd-4014-a78b-69e62fc239a5",
          "serviceName": "Bölgesel Lazer",
          "entryType": "purchase",
          "delta": 10,
          "appointmentId": null,
          "actorUserId": "8c4ab993-a09d-4357-9928-756a26957790",
          "reason": null,
          "reversesEntryId": null,
          "createdAt": "2026-08-28T07:50:06.009Z"
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `GET /customers/:id/package-entitlements` → 200.
    ///
    /// **Çıplak dizi** — `{ "data": [...] }` zarfı YOK.
    static let packageEntitlements = """
    [
      {
        "customerPackageItemId": "6323ae6d-7fa0-44c5-92b4-6b7a1f31e39a",
        "customerPackageId": "04c1303e-ef53-407c-8be7-51976240b091",
        "packageName": "10 Seans Lazer + 2 Bakim",
        "serviceId": "38b89510-8bbd-4014-a78b-69e62fc239a5",
        "serviceName": "Bölgesel Lazer",
        "remainingSessions": 9,
        "expiresAt": "2027-08-28T07:50:06.015Z",
        "branchId": "f14abe4a-b673-4116-8979-c5459fc7a899"
      },
      {
        "customerPackageItemId": "f0eb3854-ab17-4441-8197-756266fc41ad",
        "customerPackageId": "04c1303e-ef53-407c-8be7-51976240b091",
        "packageName": "10 Seans Lazer + 2 Bakim",
        "serviceId": "7589a39b-99a3-41d9-86ac-551db512eced",
        "serviceName": "Tüm Vücut Lazer",
        "remainingSessions": 2,
        "expiresAt": "2027-08-28T07:50:06.015Z",
        "branchId": "f14abe4a-b673-4116-8979-c5459fc7a899"
      }
    ]
    """

    /// `GET /reports/packages/outstanding` → 200.
    static let outstandingReport = """
    {
      "totals": {
        "packages": 1,
        "remainingSessions": 11,
        "outstandingMinor": 1125000,
        "currency": "TRY"
      },
      "data": [
        {
          "groupId": "38b89510-8bbd-4014-a78b-69e62fc239a5",
          "groupLabel": "Bölgesel Lazer",
          "packages": 1,
          "remainingSessions": 9,
          "outstandingMinor": 675000
        },
        {
          "groupId": "7589a39b-99a3-41d9-86ac-551db512eced",
          "groupLabel": "Tüm Vücut Lazer",
          "packages": 1,
          "remainingSessions": 2,
          "outstandingMinor": 450000
        }
      ]
    }
    """

    /// `GET /reports/packages/expiring` → 200.
    ///
    /// `outstandingMinor` `report.revenue:read` iznine sahip kullanıcıda dolu.
    static let expiringReport = """
    {
      "data": [
        {
          "customerPackageId": "04c1303e-ef53-407c-8be7-51976240b091",
          "customerId": "c4c007f0-1e33-4cb1-be96-2eb4de47f012",
          "customerName": "Ayşe Yılmaz",
          "packageName": "10 Seans Lazer + 2 Bakim",
          "branchId": "f14abe4a-b673-4116-8979-c5459fc7a899",
          "remainingSessions": 11,
          "expiresAt": "2027-08-28T07:50:06.015Z",
          "outstandingMinor": 1125000
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `GET /reports/packages/usage` → 200.
    static let usageReport = """
    {
      "data": [
        {
          "groupId": "38b89510-8bbd-4014-a78b-69e62fc239a5",
          "groupLabel": "Bölgesel Lazer",
          "purchased": 10,
          "consumed": 0,
          "refunded": 0,
          "expired": 0,
          "transferred": 0,
          "adjusted": -1
        },
        {
          "groupId": "7589a39b-99a3-41d9-86ac-551db512eced",
          "groupLabel": "Tüm Vücut Lazer",
          "purchased": 2,
          "consumed": 0,
          "refunded": 0,
          "expired": 0,
          "transferred": 0,
          "adjusted": 0
        }
      ]
    }
    """

    /// `POST /customer-packages/:id/adjust` → 409, hak yetersiz.
    static let packageExhausted = """
    {
      "type": "https://errors.klinara.app/package-exhausted",
      "title": "Paket hakkı yetersiz",
      "status": 409,
      "code": "PACKAGE_EXHAUSTED",
      "instance": "/api/v1/customer-packages/04c1303e-ef53-407c-8be7-51976240b091/adjust",
      "requestId": "7189b5e7-099f-4d80-bbf1-e8875a0048c3",
      "detail": "Bu kalemde kalan seans hakkı yok."
    }
    """

    /// `POST /appointments` → 201, hizmet kalemi bir paket kalemine bağlı.
    ///
    /// `customerPackageItemId` yanıt DTO'sunda döner (§0 sunucu eki);
    /// istemci "bu hizmet paketten düşecek mi" sorusunu bununla cevaplıyor.
    static let appointmentWithPackage = """
    {
      "id": "9a276797-81ad-471d-a096-eb0ef18b16ba",
      "tenantId": "f676ed23-f2b9-45c4-932a-38797911305a",
      "branchId": "f14abe4a-b673-4116-8979-c5459fc7a899",
      "customerId": "c4c007f0-1e33-4cb1-be96-2eb4de47f012",
      "status": "scheduled",
      "startsAt": "2026-09-07T10:00:00+03:00",
      "endsAt": "2026-09-07T10:30:00+03:00",
      "origin": "internal",
      "notes": null,
      "cancellationReason": null,
      "version": 1,
      "totalMinor": 50000,
      "createdAt": "2026-08-28T07:50:06.150Z",
      "services": [
        {
          "id": "52edf331-97b6-4319-bce8-63b1413a63dd",
          "serviceId": "38b89510-8bbd-4014-a78b-69e62fc239a5",
          "staffProfileId": "903914cb-aa75-4eb4-b33a-7ad120391d4d",
          "sortOrder": 0,
          "startsAt": "2026-09-07T10:00:00+03:00",
          "endsAt": "2026-09-07T10:30:00+03:00",
          "durationMinutes": 30,
          "bufferBeforeMinutes": 0,
          "bufferAfterMinutes": 0,
          "priceMinor": 50000,
          "vatRateBasisPoints": 2000,
          "customerPackageItemId": "6323ae6d-7fa0-44c5-92b4-6b7a1f31e39a"
        }
      ]
    }
    """
}
