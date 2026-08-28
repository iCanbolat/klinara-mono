import Foundation

/// Mock randevuların tohumu ve ``Appointment`` için mock'a özgü yardımcılar.
///
/// Kimlikler sabit değil (randevular her açılışta "bugüne" göre kurulur), ama
/// hangi müşteri ve hizmetlere bağlandıkları sabit: aynı senaryo her zaman aynı
/// takvimi verir.
enum MockBookingSeed {

    static let timezone = "Europe/Istanbul"
    static let slotGranularityMinutes = 15

    /// `Idempotency-Key` karşılaştırmasında kullanılan gövde imzası.
    /// Sunucu `sha256(JSON.stringify(body))` kullanıyor; buradaki karşılığı
    /// alanları sırayla birleştirmek — aynı ayrımı yapmaya yetiyor.
    static func signature(of input: CreateAppointmentInput) -> String {
        let lines = input.services
            .map { "\($0.serviceId):\($0.staffProfileId)" }
            .joined(separator: "|")
        return [input.branchId, input.customerId, input.startsAt, lines, input.notes ?? ""]
            .joined(separator: "~")
    }

    static func creationEntry(for record: Appointment) -> AppointmentHistoryEntry {
        AppointmentHistoryEntry(
            id: MockIDs.uuid(),
            action: .created,
            actorUserId: MockIDs.userOwner,
            fromStatus: nil,
            toStatus: record.status,
            oldStartsAt: nil,
            newStartsAt: nil,
            reason: nil,
            createdAt: record.createdAt
        )
    }

    /// Senaryoya göre bugünün takvimi.
    ///
    /// Bugün pazar ya da personelin izin günüyse takvim yine dolu görünür —
    /// mock çalışma saatlerini burada **zorlamaz**, tohum verinin amacı
    /// ekranları göstermek. Uygunluk motoru saatleri zaten ayrıca uyguluyor.
    static func appointments(
        scenario: MockDataScenario,
        services: [ClinicService],
        profiles: [StaffProfile],
        customers: [Customer]
    ) -> [Appointment] {
        guard scenario != .emptyDay else { return [] }
        guard let ayse = profiles.first(where: { $0.id == MockStaffSeed.profileAyse }),
              let lazer = services.first(where: { $0.id == MockCatalogSeed.serviceLazerTumVucut }),
              !customers.isEmpty
        else { return [] }

        let clock = BranchClock(timeZoneIdentifier: timezone)
        let today = clock.startOfDay(MockNow.reference)
        let branchId = MockIDs.branchNisantasi
        let bolgesel = services.first { $0.id == MockCatalogSeed.serviceLazerBolgesel } ?? lazer

        var plans: [(ClockTime, ClinicService, AppointmentStatus, Customer)] = [
            (ClockTime(hour: 9, minute: 30), lazer, .completed, customers[0]),
            (ClockTime(hour: 11, minute: 0), bolgesel, .arrived, customers[min(1, customers.count - 1)]),
            (ClockTime(hour: 15, minute: 0), lazer, .scheduled, customers[0]),
        ]

        if scenario == .conflictHeavy {
            // Gün neredeyse kapalı: geriye tek tük boşluk kalsın ki çakışma
            // ekranı ve öneri listesi kolayca tetiklenebilsin.
            plans.append(contentsOf: [
                (ClockTime(hour: 10, minute: 30), bolgesel, .confirmed, customers[0]),
                (ClockTime(hour: 12, minute: 0), bolgesel, .confirmed, customers[min(1, customers.count - 1)]),
                (ClockTime(hour: 14, minute: 0), bolgesel, .scheduled, customers[min(2, customers.count - 1)]),
                (ClockTime(hour: 16, minute: 30), lazer, .cancelled, customers[min(3, customers.count - 1)]),
            ])
        }

        return plans.enumerated().map { index, plan in
            let (time, service, status, customer) = plan
            let effective = service.effective(in: branchId)
            let start = clock.date(on: today, at: time)
            let end = clock.adding(minutes: effective.durationMinutes, to: start)
            let line = AppointmentServiceLine(
                id: MockIDs.uuid(),
                serviceId: service.id,
                staffProfileId: ayse.id,
                sortOrder: 0,
                startsAt: start,
                endsAt: end,
                durationMinutes: effective.durationMinutes,
                bufferBeforeMinutes: effective.bufferBeforeMinutes,
                bufferAfterMinutes: effective.bufferAfterMinutes,
                priceMinor: effective.priceMinor,
                vatRateBasisPoints: effective.vatRateBasisPoints,
                customerPackageItemId: nil
            )
            return Appointment(
                id: MockIDs.uuid(),
                tenantId: MockIDs.tenant,
                branchId: branchId,
                customerId: customer.id,
                status: status,
                startsAt: start,
                endsAt: end,
                origin: index == 2 ? .online : .internal,
                notes: index == 0 ? "İlk seans, cilt testi yapıldı." : nil,
                cancellationReason: status == .cancelled ? "Müşteri erteledi" : nil,
                version: 1,
                totalMinor: effective.priceMinor,
                createdAt: clock.adding(days: -3, to: start),
                services: [line]
            )
        }
    }
}

// MARK: - Değer güncelleme

extension Appointment {

    /// Değişen alanları taşıyan yeni bir kopya.
    ///
    /// Tüm alanlar `let`: sunucudan gelen bir kaydın yerinde değiştirilebilmesi,
    /// yanıtın dışında bir yerde "gerçek" bir sürüm daha olabileceği anlamına
    /// gelirdi. Mock ve store'lar bunun yerine yeni kopya üretir.
    func with(
        status: AppointmentStatus? = nil,
        startsAt: Date? = nil,
        endsAt: Date? = nil,
        notes: String?? = nil,
        cancellationReason: String? = nil,
        services: [AppointmentServiceLine]? = nil,
        totalMinor: Int? = nil,
        version: Int? = nil
    ) -> Appointment {
        Appointment(
            id: id,
            tenantId: tenantId,
            branchId: branchId,
            customerId: customerId,
            status: status ?? self.status,
            startsAt: startsAt ?? self.startsAt,
            endsAt: endsAt ?? self.endsAt,
            origin: origin,
            notes: notes ?? self.notes,
            cancellationReason: cancellationReason ?? self.cancellationReason,
            version: version ?? self.version,
            totalMinor: totalMinor ?? self.totalMinor,
            createdAt: createdAt,
            services: services ?? self.services
        )
    }

    /// Detay kaydının liste satırına indirgenmiş hâli.
    ///
    /// Sunucu bu dönüşümü sorguda yapıyor (müşteri adı ve hizmet adı JOIN'le
    /// geliyor). Mock'ta ve store'da yazma sonrası listeyi **yeniden çekmeden**
    /// güncelleyebilmek için aynı dönüşüm burada da gerekiyor.
    func calendarEntry(services catalog: [ClinicService], customers: [Customer]) -> CalendarEntry {
        let customer = customers.first { $0.id == customerId }
        return CalendarEntry(
            id: id,
            branchId: branchId,
            customerId: customerId,
            customerName: customer?.fullName ?? "Bilinmeyen müşteri",
            customerPhone: customer?.phone,
            status: status,
            startsAt: startsAt,
            endsAt: endsAt,
            notes: notes,
            version: version,
            totalMinor: totalMinor,
            services: services.map { line in
                CalendarEntryServiceLine(
                    id: line.id,
                    serviceId: line.serviceId,
                    serviceName: catalog.first { $0.id == line.serviceId }?.name ?? "Hizmet",
                    staffProfileId: line.staffProfileId,
                    sortOrder: line.sortOrder,
                    startsAt: line.startsAt,
                    endsAt: line.endsAt,
                    priceMinor: line.priceMinor
                )
            }
        )
    }
}
