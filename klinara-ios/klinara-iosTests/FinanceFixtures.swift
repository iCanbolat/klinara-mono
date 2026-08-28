import Foundation
@testable import klinara_ios

/// Faz 6 (finans) yanıt gövdeleri — sunucudan **birebir** yakalandı.
///
/// Gövdeler `apps/api` entegrasyon test altyapısı ayağa kaldırılıp gerçek HTTP
/// uçlarına gidilerek alındı (`test/helpers/app` + gerçek Postgres); alan
/// adları, `null`'lar, tarih biçimleri ve tutarlar olduğu gibi duruyor.
/// ``PackageFixtures`` ile aynı disiplin: elle kurulmuş örnekler sözleşmeyi
/// test etmez, yalnız kendi varsayımımızı tekrar eder.
extension Fixtures {
    /// `POST /charges` → 201.
    ///
    /// Elle açılmış, **indirimli ve fiyat override'lı** bir kalem: 2 × 45.000
    /// (liste 50.000) − %15 indirim = 76.500 brüt. KDV fiyata DAHİL, %20 →
    /// 12.750 KDV, 63.750 net. `netMinor + vatMinor` daima `totalMinor`a eşit.
    static let charge = """
    {
      "id": "a7f3a51c-00a4-42b0-ac67-bb97b254a44f",
      "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
      "customerId": "35386256-88a2-4610-a3ef-c70f04ff444c",
      "source": "product",
      "appointmentServiceId": null,
      "customerPackageId": null,
      "description": "Bakım şampuanı 250 ml",
      "quantity": 2,
      "unitListPriceMinor": 50000,
      "unitPriceMinor": 45000,
      "discountId": "11695880-82c8-4315-9260-0dac86bbd56a",
      "discountKind": "percent",
      "discountValue": 1500,
      "discountMinor": 13500,
      "vatRateBasisPoints": 2000,
      "totalMinor": 76500,
      "netMinor": 63750,
      "vatMinor": 12750,
      "currency": "TRY",
      "status": "open",
      "priceOverrideReason": "Kampanya fiyatı uygulandı",
      "voidedAt": null,
      "voidedReason": null,
      "version": 1,
      "createdAt": "2026-08-28T13:56:42.237Z"
    }
    """

    /// `GET /charges?customerId=…` → 200.
    ///
    /// İki kalem: biri elle açılan ürün, diğeri randevu tamamlanınca **kendiliğinden**
    /// doğan hizmet kalemi (`appointmentServiceId` dolu, `discountId` null).
    static let chargePage = """
    {
      "data": [
        {
          "id": "a7f3a51c-00a4-42b0-ac67-bb97b254a44f",
          "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
          "customerId": "35386256-88a2-4610-a3ef-c70f04ff444c",
          "source": "product",
          "appointmentServiceId": null,
          "customerPackageId": null,
          "description": "Bakım şampuanı 250 ml",
          "quantity": 2,
          "unitListPriceMinor": 50000,
          "unitPriceMinor": 45000,
          "discountId": "11695880-82c8-4315-9260-0dac86bbd56a",
          "discountKind": "percent",
          "discountValue": 1500,
          "discountMinor": 13500,
          "vatRateBasisPoints": 2000,
          "totalMinor": 76500,
          "netMinor": 63750,
          "vatMinor": 12750,
          "currency": "TRY",
          "status": "open",
          "priceOverrideReason": "Kampanya fiyatı uygulandı",
          "voidedAt": null,
          "voidedReason": null,
          "version": 1,
          "createdAt": "2026-08-28T13:56:42.237Z"
        },
        {
          "id": "5773095f-9c30-4a25-af6e-4bb658e06966",
          "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
          "customerId": "35386256-88a2-4610-a3ef-c70f04ff444c",
          "source": "appointment_service",
          "appointmentServiceId": "f6b38d67-4aae-4345-bfe4-f7f896417066",
          "customerPackageId": null,
          "description": "Bölgesel Lazer",
          "quantity": 1,
          "unitListPriceMinor": 50000,
          "unitPriceMinor": 50000,
          "discountId": null,
          "discountKind": null,
          "discountValue": null,
          "discountMinor": 0,
          "vatRateBasisPoints": 2000,
          "totalMinor": 50000,
          "netMinor": 41667,
          "vatMinor": 8333,
          "currency": "TRY",
          "status": "open",
          "priceOverrideReason": null,
          "voidedAt": null,
          "voidedReason": null,
          "version": 1,
          "createdAt": "2026-08-28T13:56:42.210Z"
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `GET /customers/:id/account` → 200.
    ///
    /// Bakiye view'dan geliyor: 126.500 borç − 30.000 tahsilat = 96.500.
    /// Tahsilat satırı **negatif** tutarla düşüyor ve `entrySource` orada
    /// yöntem (`cash`), kalemlerde ise kaynak (`product`, `appointment_service`).
    static let account = """
    {
      "customerId": "35386256-88a2-4610-a3ef-c70f04ff444c",
      "chargedMinor": 126500,
      "paidMinor": 30000,
      "balanceMinor": 96500,
      "currency": "TRY",
      "entries": [
        {
          "entryId": "175a310b-3fd3-4d8c-9f5b-a4cee826b053",
          "entryKind": "payment",
          "entrySource": "cash",
          "description": "Tahsilat #1",
          "amountMinor": -30000,
          "currency": "TRY",
          "occurredAt": "2026-08-28T13:56:42.284Z"
        },
        {
          "entryId": "a7f3a51c-00a4-42b0-ac67-bb97b254a44f",
          "entryKind": "charge",
          "entrySource": "product",
          "description": "Bakım şampuanı 250 ml",
          "amountMinor": 76500,
          "currency": "TRY",
          "occurredAt": "2026-08-28T13:56:42.237Z"
        },
        {
          "entryId": "5773095f-9c30-4a25-af6e-4bb658e06966",
          "entryKind": "charge",
          "entrySource": "appointment_service",
          "description": "Bölgesel Lazer",
          "amountMinor": 50000,
          "currency": "TRY",
          "occurredAt": "2026-08-28T13:56:42.210Z"
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `POST /payments` → 201, tahsis VERİLMEDEN.
    ///
    /// Sunucu açık kalemlere eskiden yeniye dağıttı: 30.000 tamamen en eski
    /// kaleme (randevu hizmeti) gitti, ürün kalemine hiç dokunmadı.
    /// `receiptNo` 1 — makbuz sayacı boşluksuz.
    static let payment = """
    {
      "id": "175a310b-3fd3-4d8c-9f5b-a4cee826b053",
      "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
      "customerId": "35386256-88a2-4610-a3ef-c70f04ff444c",
      "method": "cash",
      "amountMinor": 30000,
      "allocatedMinor": 30000,
      "unallocatedMinor": 0,
      "currency": "TRY",
      "receiptNo": 1,
      "paidAt": "2026-08-28T13:56:42.284Z",
      "cashSessionId": "681f41ea-67ad-4797-9151-8a6ec3c6608b",
      "note": "Kısmi ödeme",
      "status": "posted",
      "voidedAt": null,
      "voidedReason": null,
      "allocations": [
        {
          "id": "07254d49-85d8-402f-beb4-28a6ce1c5c78",
          "chargeId": "5773095f-9c30-4a25-af6e-4bb658e06966",
          "amountMinor": 30000,
          "chargeDescription": "Bölgesel Lazer"
        }
      ],
      "version": 1,
      "createdAt": "2026-08-28T13:56:42.276Z"
    }
    """

    /// `GET /payments?customerId=…` → 200.
    static let paymentPage = """
    {
      "data": [
        {
          "id": "175a310b-3fd3-4d8c-9f5b-a4cee826b053",
          "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
          "customerId": "35386256-88a2-4610-a3ef-c70f04ff444c",
          "method": "cash",
          "amountMinor": 30000,
          "allocatedMinor": 30000,
          "unallocatedMinor": 0,
          "currency": "TRY",
          "receiptNo": 1,
          "paidAt": "2026-08-28T13:56:42.284Z",
          "cashSessionId": "681f41ea-67ad-4797-9151-8a6ec3c6608b",
          "note": "Kısmi ödeme",
          "status": "posted",
          "voidedAt": null,
          "voidedReason": null,
          "allocations": [
            {
              "id": "07254d49-85d8-402f-beb4-28a6ce1c5c78",
              "chargeId": "5773095f-9c30-4a25-af6e-4bb658e06966",
              "amountMinor": 30000,
              "chargeDescription": "Bölgesel Lazer"
            }
          ],
          "version": 1,
          "createdAt": "2026-08-28T13:56:42.276Z"
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `POST /payments/:id/void` → 200.
    ///
    /// **Tahsis satırı duruyor**: `allocations` boşalmadı, yalnız `status` `void`
    /// oldu. Bakiye geri geliyor ama makbuzun neyi kapattığı kayıtta kalıyor.
    static let paymentVoided = """
    {
      "id": "175a310b-3fd3-4d8c-9f5b-a4cee826b053",
      "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
      "customerId": "35386256-88a2-4610-a3ef-c70f04ff444c",
      "method": "cash",
      "amountMinor": 30000,
      "allocatedMinor": 30000,
      "unallocatedMinor": 0,
      "currency": "TRY",
      "receiptNo": 1,
      "paidAt": "2026-08-28T13:56:42.284Z",
      "cashSessionId": "681f41ea-67ad-4797-9151-8a6ec3c6608b",
      "note": "Kısmi ödeme",
      "status": "void",
      "voidedAt": "2026-08-28T13:56:42.501Z",
      "voidedReason": "Yanlış müşteriye kaydedildi",
      "allocations": [
        {
          "id": "07254d49-85d8-402f-beb4-28a6ce1c5c78",
          "chargeId": "5773095f-9c30-4a25-af6e-4bb658e06966",
          "amountMinor": 30000,
          "chargeDescription": "Bölgesel Lazer"
        }
      ],
      "version": 2,
      "createdAt": "2026-08-28T13:56:42.276Z"
    }
    """

    /// `POST /cash-sessions/open` → 201.
    ///
    /// Açık oturumda `expectedMinor`, `countedMinor` ve `differenceMinor` **null**:
    /// üçü de kapanışta hesaplanıyor.
    static let cashSessionOpen = """
    {
      "id": "681f41ea-67ad-4797-9151-8a6ec3c6608b",
      "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
      "status": "open",
      "openingBalanceMinor": 50000,
      "openedAt": "2026-08-28T13:56:42.265Z",
      "closedAt": null,
      "expectedMinor": null,
      "countedMinor": null,
      "differenceMinor": null,
      "differenceReason": null,
      "currency": "TRY",
      "version": 1
    }
    """

    /// `POST /cash-sessions/:id/close` → 200, **farklı** kapanış.
    ///
    /// Beklenen 75.000 (50.000 açılış + 30.000 tahsilat − 5.000 iade),
    /// sayılan 70.000 → fark −5.000 ve gerekçe zorunlu olduğu için dolu.
    static let cashSessionClosed = """
    {
      "id": "681f41ea-67ad-4797-9151-8a6ec3c6608b",
      "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
      "status": "closed",
      "openingBalanceMinor": 50000,
      "openedAt": "2026-08-28T13:56:42.265Z",
      "closedAt": "2026-08-28T13:56:42.492Z",
      "expectedMinor": 75000,
      "countedMinor": 70000,
      "differenceMinor": -5000,
      "differenceReason": "Bozuk para farkı",
      "currency": "TRY",
      "version": 2
    }
    """

    /// `GET /cash-sessions` → 200.
    static let cashSessionPage = """
    {
      "data": [
        {
          "id": "681f41ea-67ad-4797-9151-8a6ec3c6608b",
          "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
          "status": "open",
          "openingBalanceMinor": 50000,
          "openedAt": "2026-08-28T13:56:42.265Z",
          "closedAt": null,
          "expectedMinor": null,
          "countedMinor": null,
          "differenceMinor": null,
          "differenceReason": null,
          "currency": "TRY",
          "version": 1
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `GET /cash-sessions/:id/summary` → 200.
    ///
    /// `expectedMinor` (80.000) yalnız **nakit** hareketlerden doğuyor;
    /// `byMethod` ise oturumdaki tüm tahsilatları yöntemine göre ayırıyor.
    /// Bu örnekte iade henüz yazılmamıştı, hareketler açılış + tahsilat.
    static let cashSummary = """
    {
      "session": {
        "id": "681f41ea-67ad-4797-9151-8a6ec3c6608b",
        "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
        "status": "open",
        "openingBalanceMinor": 50000,
        "openedAt": "2026-08-28T13:56:42.265Z",
        "closedAt": null,
        "expectedMinor": null,
        "countedMinor": null,
        "differenceMinor": null,
        "differenceReason": null,
        "currency": "TRY",
        "version": 1
      },
      "expectedMinor": 80000,
      "byMethod": [
        {
          "method": "cash",
          "amountMinor": 30000,
          "count": 1
        }
      ],
      "movements": [
        {
          "id": "8f814c44-cf15-4225-95a3-bd85bbc54f23",
          "kind": "opening",
          "amountMinor": 50000,
          "paymentId": null,
          "refundId": null,
          "note": "Açılış bakiyesi",
          "createdAt": "2026-08-28T13:56:42.265Z"
        },
        {
          "id": "1b45a0d8-5ef6-4545-88a8-f8c3fe01c886",
          "kind": "payment",
          "amountMinor": 30000,
          "paymentId": "175a310b-3fd3-4d8c-9f5b-a4cee826b053",
          "refundId": null,
          "note": "Tahsilat #1",
          "createdAt": "2026-08-28T13:56:42.276Z"
        }
      ]
    }
    """

    /// `POST /refunds` → 201, nakit hizmet iadesi.
    ///
    /// Tutar **pozitif** taşınıyor; yön `kind` ile belli. `packageSettlementStatus`
    /// yalnız paket iadesinde dolu, burada null.
    static let refund = """
    {
      "id": "772f975d-5514-47fd-89a2-4840b5ec9800",
      "customerId": "35386256-88a2-4610-a3ef-c70f04ff444c",
      "kind": "service",
      "amountMinor": 5000,
      "method": "cash",
      "chargeId": null,
      "customerPackageId": null,
      "cashSessionId": "681f41ea-67ad-4797-9151-8a6ec3c6608b",
      "reason": "Hizmet yarıda kaldı",
      "refundedAt": "2026-08-28T13:56:42.332Z",
      "packageSettlementStatus": null
    }
    """

    /// `POST /discounts` → 201.
    ///
    /// `value` **baz puan**: 1500 = %15. `startsAt`/`endsAt` null = süresiz.
    static let discount = """
    {
      "id": "11695880-82c8-4315-9260-0dac86bbd56a",
      "code": "YAZ2026",
      "name": "Yaz kampanyası",
      "kind": "percent",
      "value": 1500,
      "scope": "all",
      "scopeRefId": null,
      "startsAt": null,
      "endsAt": null,
      "maxRedemptions": 100,
      "redeemedCount": 0,
      "isActive": true,
      "version": 1,
      "createdAt": "2026-08-28T13:56:42.120Z"
    }
    """

    /// `GET /discounts` → 200.
    static let discountPage = """
    {
      "data": [
        {
          "id": "11695880-82c8-4315-9260-0dac86bbd56a",
          "code": "YAZ2026",
          "name": "Yaz kampanyası",
          "kind": "percent",
          "value": 1500,
          "scope": "all",
          "scopeRefId": null,
          "startsAt": null,
          "endsAt": null,
          "maxRedemptions": 100,
          "redeemedCount": 0,
          "isActive": true,
          "version": 1,
          "createdAt": "2026-08-28T13:56:42.120Z"
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `POST /commission-rules` → 201.
    ///
    /// `value` baz puan (1000 = %10). `effectiveFrom` bir **tarih** (`YYYY-MM-DD`),
    /// timestamp değil — çözücünün tarih stratejisine takılmaması gereken alan.
    static let commissionRule = """
    {
      "id": "646f469b-83d7-4147-9807-fb52e123ab93",
      "name": "Genel prim %10",
      "scope": "global",
      "scopeRefId": null,
      "staffProfileId": null,
      "calcKind": "percent",
      "value": 1000,
      "basis": "net_after_discount",
      "triggerOn": "service_completed",
      "priority": 0,
      "effectiveFrom": "2026-01-01",
      "effectiveTo": null,
      "isActive": true,
      "version": 1
    }
    """

    /// `GET /commission-rules` → 200.
    static let commissionRulePage = """
    {
      "data": [
        {
          "id": "646f469b-83d7-4147-9807-fb52e123ab93",
          "name": "Genel prim %10",
          "scope": "global",
          "scopeRefId": null,
          "staffProfileId": null,
          "calcKind": "percent",
          "value": 1000,
          "basis": "net_after_discount",
          "triggerOn": "service_completed",
          "priority": 0,
          "effectiveFrom": "2026-01-01",
          "effectiveTo": null,
          "isActive": true,
          "version": 1
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `GET /commissions/accruals` → 200.
    ///
    /// Randevu tamamlanınca doğan tahakkuk: matrah 50.000, %10 → 5.000.
    /// `reversesAccrualId` null; ters kayıt değil.
    static let commissionAccrualPage = """
    {
      "data": [
        {
          "id": "c112fff2-857e-4b2a-b908-19b486f5f5e7",
          "staffProfileId": "58cc6077-ed61-40cb-bb46-d83985e165c7",
          "periodId": "d119f11e-4b69-41c3-bd03-737e49e5bc50",
          "triggerOn": "service_completed",
          "ruleBasis": "net_after_discount",
          "basisMinor": 50000,
          "amountMinor": 5000,
          "chargeId": "8c344b2b-e340-4890-80e1-dce8ae40fe4d",
          "paymentId": null,
          "reversesAccrualId": null,
          "reason": null,
          "createdAt": "2026-08-28T13:56:42.438Z"
        }
      ],
      "pageInfo": {
        "hasMore": false,
        "nextCursor": null
      }
    }
    """

    /// `GET /commission-periods` → 200 — **ÇIPLAK DİZİ**.
    ///
    /// `{ "data": [...] }` zarfı YOK; `GET /customers/:id/package-entitlements`
    /// ile aynı istisna. Dönem ilk tahakkukta otomatik açıldı.
    static let commissionPeriods = """
    [
      {
        "id": "d119f11e-4b69-41c3-bd03-737e49e5bc50",
        "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
        "startsOn": "2026-08-01",
        "endsOn": "2026-08-31",
        "status": "open",
        "closedAt": null,
        "version": 1
      }
    ]
    """

    /// `POST /commission-periods/:id/close` → 200.
    static let commissionPeriodClosed = """
    {
      "id": "d119f11e-4b69-41c3-bd03-737e49e5bc50",
      "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
      "startsOn": "2026-08-01",
      "endsOn": "2026-08-31",
      "status": "closed",
      "closedAt": "2026-08-28T13:56:42.479Z",
      "version": 2
    }
    """

    /// `GET /reports/commissions` → 200.
    ///
    /// Satır toplamı `totalMinor` ile tutmalı; ters kayıtlar zaten düşülmüş gelir.
    static let commissionReport = """
    {
      "rows": [
        {
          "staffProfileId": "58cc6077-ed61-40cb-bb46-d83985e165c7",
          "staffName": "Demo Uygulayıcı",
          "amountMinor": 5000,
          "accrualCount": 1
        }
      ],
      "totalMinor": 5000,
      "currency": "TRY"
    }
    """

    /// `POST /payments` (nakit, kasa YOKKEN) → 409 `CASH_SESSION_REQUIRED`.
    static let cashSessionRequiredProblem = """
    {
      "type": "https://errors.klinara.app/cash-session-required",
      "title": "Nakit tahsilat için açık bir kasa oturumu gerekli",
      "status": 409,
      "code": "CASH_SESSION_REQUIRED",
      "instance": "/api/v1/payments",
      "requestId": "8700c8ac-edfa-4720-8984-9db2c2edde54",
      "detail": "Önce `POST /cash-sessions/open` ile kasayı açın."
    }
    """

    /// `POST /cash-sessions/open` (ikinci kez) → 409 `CASH_SESSION_ALREADY_OPEN`.
    static let cashSessionAlreadyOpenProblem = """
    {
      "type": "https://errors.klinara.app/cash-session-already-open",
      "title": "Bu şubede zaten açık bir kasa oturumu var",
      "status": 409,
      "code": "CASH_SESSION_ALREADY_OPEN",
      "instance": "/api/v1/cash-sessions/open",
      "requestId": "4e033225-ec2b-46c0-bea0-c8944ce3c3d4",
      "detail": "Yeni oturum açmadan önce mevcut oturumu kapatın."
    }
    """

    /// `POST /payments` (kalem bakiyesini aşan tahsis) → 409 `PAYMENT_EXCEEDS_BALANCE`.
    static let paymentExceedsBalanceProblem = """
    {
      "type": "https://errors.klinara.app/payment-exceeds-balance",
      "title": "Tahsis edilen tutar bakiyeyi aşıyor",
      "status": 409,
      "code": "PAYMENT_EXCEEDS_BALANCE",
      "instance": "/api/v1/payments",
      "requestId": "ce397481-ab22-4d66-aa74-1ee77a4942b6",
      "detail": "Bir kaleme tahsis edilen toplam, kalemin tutarını aşamaz."
    }
    """

    /// `POST /charges` (süresi dolmuş indirim) → 409 `DISCOUNT_INVALID`.
    static let discountInvalidProblem = """
    {
      "type": "https://errors.klinara.app/discount-invalid",
      "title": "İndirim uygulanamaz",
      "status": 409,
      "code": "DISCOUNT_INVALID",
      "instance": "/api/v1/charges",
      "requestId": "7c97e6b8-22b8-4d0e-a735-6e9f220f5dc0",
      "detail": "İndirim pasif, süresi dolmuş ya da kullanım hakkı tükenmiş."
    }
    """

    /// `POST /commission-periods/:id/close` (kapalı dönem) → 409 `PERIOD_CLOSED`.
    ///
    /// `detail` alanı YOK — istemci `displayMessage`ı koda göre üretmeli.
    static let periodClosedProblem = """
    {
      "type": "https://errors.klinara.app/period-closed",
      "title": "Prim dönemi zaten kapalı",
      "status": 409,
      "code": "PERIOD_CLOSED",
      "instance": "/api/v1/commission-periods/d119f11e-4b69-41c3-bd03-737e49e5bc50/close",
      "requestId": "3707365d-cfb8-4874-91a5-f31a1b5af780"
    }
    """

    /// Bilinmeyen bir `source` taşıyan kalem — **elle kuruldu**, sunucu bugün
    /// böyle bir değer üretmiyor.
    ///
    /// Bunu yakalamanın başka yolu yok: sınanan şey, sunucu yarın yeni bir
    /// kalem kaynağı eklediğinde eski istemcinin cari hesabı **hiç açamaz**
    /// hâle gelip gelmediği. Gerçek gövdeden tek farkı `source` alanı.
    static let chargeUnknownSource = """
    {
      "id": "a7f3a51c-00a4-42b0-ac67-bb97b254a44f",
      "branchId": "9768913c-c0bc-4353-9583-bcdc64350e3a",
      "customerId": "35386256-88a2-4610-a3ef-c70f04ff444c",
      "source": "subscription_fee",
      "appointmentServiceId": null,
      "customerPackageId": null,
      "description": "Üyelik aidatı",
      "quantity": 1,
      "unitListPriceMinor": 50000,
      "unitPriceMinor": 50000,
      "discountId": null,
      "discountKind": null,
      "discountValue": null,
      "discountMinor": 0,
      "vatRateBasisPoints": 2000,
      "totalMinor": 50000,
      "netMinor": 41667,
      "vatMinor": 8333,
      "currency": "TRY",
      "status": "open",
      "priceOverrideReason": null,
      "voidedAt": null,
      "voidedReason": null,
      "version": 1,
      "createdAt": "2026-08-28T13:56:42.237Z"
    }
    """
}
