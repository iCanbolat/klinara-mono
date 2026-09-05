import Foundation

/// Batch 10.1 rapor gövdeleri — **gerçek sunucudan yakalandı**.
///
/// Ek L'deki yöntem: `apps/api` entegrasyon test altyapısı (testcontainers +
/// gerçek PostgreSQL) ayağa kaldırıldı, bir klinik kuruldu (iki tamamlanmış
/// randevu, bir no-show, elle bir ücret kalemi, bir kart tahsilatı) ve gerçek
/// HTTP uçlarına gidilerek yanıtlar diske yazıldı. Yakalama dosyası geçiciydi
/// ve silindi.
///
/// Elle kurulmuş TEK BİR gövde yok: hepsi sunucunun fiilen ürettiği JSON.
/// Bu yüzden bu testler bir sözleşme testi — sunucu bir alanı yeniden
/// adlandırırsa ya da bir sayıyı `string` olarak dönerse burada kırılır.
///
/// ⚠️ İKİ AYRI PENCERE kullanıldı ve bu, verinin kendi doğasından geliyor:
/// randevular sabit bir haftaya (`2026-09-07`) yazılıyor, ücret kalemi ve
/// tahsilat ise `now()` ile. Tek bir pencere seçmek para raporlarını BOŞ
/// yakalardı — ve boş bir fixture, hiçbir şeyi sınamayan bir test demekti.
enum ReportFixtures {

    static let occupancy = """
    {
      "scope": "all",
      "period": {
        "from": "2026-09-07T00:00:00+03:00",
        "to": "2026-09-14T00:00:00+03:00"
      },
      "totals": {
        "bookedMinutes": 60,
        "availableMinutes": 3240,
        "occupancyRate": 1.85
      },
      "data": [
        {
          "groupId": "644f74bd-4a8e-4d12-918d-c68ecf0e0a40",
          "groupLabel": "Demo Uygulayıcı",
          "bookedMinutes": 60,
          "availableMinutes": 3240,
          "occupancyRate": 1.85
        }
      ],
      "previous": {
        "bookedMinutes": 0,
        "availableMinutes": 3240,
        "occupancyRate": 0
      },
      "delta": {
        "bookedMinutes": null,
        "availableMinutes": 0,
        "occupancyRate": null
      }
    }
    """

    static let occupancyByDay = """
    {
      "scope": "all",
      "period": {
        "from": "2026-09-07T00:00:00+03:00",
        "to": "2026-09-14T00:00:00+03:00"
      },
      "totals": {
        "bookedMinutes": 60,
        "availableMinutes": 3240,
        "occupancyRate": 1.85
      },
      "data": [
        {
          "groupId": null,
          "groupLabel": "2026-09-07",
          "bookedMinutes": 30,
          "availableMinutes": 540,
          "occupancyRate": 5.56
        },
        {
          "groupId": null,
          "groupLabel": "2026-09-08",
          "bookedMinutes": 0,
          "availableMinutes": 540,
          "occupancyRate": 0
        },
        {
          "groupId": null,
          "groupLabel": "2026-09-09",
          "bookedMinutes": 30,
          "availableMinutes": 540,
          "occupancyRate": 5.56
        },
        {
          "groupId": null,
          "groupLabel": "2026-09-10",
          "bookedMinutes": 0,
          "availableMinutes": 540,
          "occupancyRate": 0
        },
        {
          "groupId": null,
          "groupLabel": "2026-09-11",
          "bookedMinutes": 0,
          "availableMinutes": 540,
          "occupancyRate": 0
        },
        {
          "groupId": null,
          "groupLabel": "2026-09-12",
          "bookedMinutes": 0,
          "availableMinutes": 540,
          "occupancyRate": 0
        }
      ]
    }
    """

    static let revenue = """
    {
      "scope": "all",
      "period": {
        "from": "2020-01-01T00:00:00+03:00",
        "to": "2099-01-01T00:00:00+03:00"
      },
      "totals": {
        "accruedMinor": 350000,
        "collectedMinor": 180000,
        "refundedMinor": 0,
        "currency": "TRY"
      },
      "data": [
        {
          "groupId": null,
          "groupLabel": "—",
          "accruedMinor": 250000,
          "collectedMinor": 80000
        },
        {
          "groupId": "c8824957-3200-4b9d-b1f9-927cc793649c",
          "groupLabel": "Bölgesel Lazer",
          "accruedMinor": 100000,
          "collectedMinor": 100000
        }
      ]
    }
    """

    static let revenueByMethod = """
    {
      "scope": "all",
      "period": {
        "from": "2020-01-01T00:00:00+03:00",
        "to": "2099-01-01T00:00:00+03:00"
      },
      "totals": {
        "accruedMinor": 350000,
        "collectedMinor": 180000,
        "refundedMinor": 0,
        "currency": "TRY"
      },
      "data": [
        {
          "groupId": null,
          "groupLabel": "card",
          "accruedMinor": 0,
          "collectedMinor": 180000
        }
      ]
    }
    """

    static let staffPerformance = """
    {
      "scope": "all",
      "period": {
        "from": "2026-09-07T00:00:00+03:00",
        "to": "2026-09-14T00:00:00+03:00"
      },
      "currency": "TRY",
      "data": [
        {
          "staffProfileId": "644f74bd-4a8e-4d12-918d-c68ecf0e0a40",
          "staffName": "Demo Uygulayıcı",
          "completedServices": 2,
          "revenueMinor": 100000,
          "commissionMinor": 0,
          "bookedMinutes": 60,
          "availableMinutes": 3240,
          "occupancyRate": 1.85
        }
      ]
    }
    """

    static let staffPerformanceOwn = """
    {
      "scope": "own",
      "period": {
        "from": "2026-09-07T00:00:00+03:00",
        "to": "2026-09-14T00:00:00+03:00"
      },
      "currency": "TRY",
      "data": [
        {
          "staffProfileId": "644f74bd-4a8e-4d12-918d-c68ecf0e0a40",
          "staffName": "Demo Uygulayıcı",
          "completedServices": 2,
          "revenueMinor": 100000,
          "commissionMinor": 0,
          "bookedMinutes": 60,
          "availableMinutes": 3240,
          "occupancyRate": 1.85
        }
      ]
    }
    """

    static let noShow = """
    {
      "period": {
        "from": "2026-09-07T00:00:00+03:00",
        "to": "2026-09-14T00:00:00+03:00"
      },
      "totals": {
        "total": 3,
        "completed": 2,
        "noShow": 1,
        "cancelled": 0,
        "noShowRate": 33.33,
        "cancellationRate": 0
      },
      "data": [
        {
          "groupId": "644f74bd-4a8e-4d12-918d-c68ecf0e0a40",
          "groupLabel": "Demo Uygulayıcı",
          "total": 3,
          "completed": 2,
          "noShow": 1,
          "cancelled": 0,
          "noShowRate": 33.33,
          "cancellationRate": 0
        }
      ],
      "byOrigin": [
        {
          "origin": "internal",
          "total": 3,
          "completed": 2,
          "noShow": 1,
          "cancelled": 0,
          "noShowRate": 33.33,
          "cancellationRate": 0
        }
      ],
      "previous": {
        "total": 0,
        "completed": 0,
        "noShow": 0,
        "cancelled": 0,
        "noShowRate": 0,
        "cancellationRate": 0
      },
      "delta": {
        "total": null,
        "noShow": null,
        "noShowRate": null,
        "cancellationRate": 0
      }
    }
    """

    static let retention = """
    {
      "period": {
        "from": "2026-09-07T00:00:00+03:00",
        "to": "2026-09-14T00:00:00+03:00"
      },
      "totals": {
        "newCustomers": 1,
        "returningCustomers": 0,
        "activeCustomers": 1,
        "returningRate": 0
      },
      "acquisition": [
        {
          "source": null,
          "customers": 1
        }
      ],
      "cohorts": [
        {
          "withinDays": 30,
          "returned": 1,
          "rate": 100
        },
        {
          "withinDays": 60,
          "returned": 1,
          "rate": 100
        },
        {
          "withinDays": 90,
          "returned": 1,
          "rate": 100
        }
      ],
      "previous": {
        "newCustomers": 0,
        "returningCustomers": 0,
        "activeCustomers": 0,
        "returningRate": 0
      },
      "delta": {
        "newCustomers": null,
        "returningCustomers": 0,
        "activeCustomers": null
      }
    }
    """
}
