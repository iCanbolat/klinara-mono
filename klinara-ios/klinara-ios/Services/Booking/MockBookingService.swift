import Foundation

/// Bellek-içi takvim çekirdeği.
///
/// Bu mock **veri döndürmez, kural uygular**. Çakışmayı gerçekten hesaplar,
/// durum makinesini zorlar, sürüm arttırır ve idempotency anahtarlarını
/// hatırlar. Sebebi Faz 2'nin dersi: mock sunucudan farklı davranırsa,
/// mock'ta geçen bir akış canlıda ilk denemede kırılır ve hata yolları hiç
/// denenmemiş olur.
///
/// Kasıtlı sadeleştirmeler: kiracı tek, uygunluk penceresi 31 gün
/// doğrulanmıyor, cursor sayfalaması tek sayfa döndürüyor.
final class MockBookingService: BookingService, @unchecked Sendable {

    private let lock = NSLock()
    private let catalog: MockCatalogService
    private let staff: MockStaffService
    private let scheduling: MockSchedulingService
    private let customers: MockCustomerService

    /// Randevular. İptal edilenler **silinmez**, slotu bırakır ama listede kalır.
    private var appointments: [Appointment] = []
    private var histories: [String: [AppointmentHistoryEntry]] = [:]
    /// `Idempotency-Key` → (gövde imzası, üretilen randevu kimliği).
    private var idempotency: [String: (signature: String, appointmentId: String)] = [:]

    /// Bir müşterinin randevuları — ``MockNotesService`` zaman çizelgesini
    /// buradan kuruyor. İki mock ayrı ayrı tohumlansaydı aynı müşterinin
    /// randevusu kartta hiç görünmezdi.
    func appointmentSnapshot(customerId: String) -> [Appointment] {
        lock.lock()
        defer { lock.unlock() }
        return appointments.filter { $0.customerId == customerId }
    }

    /// Kullanıcının `appointment:reopen` izni. Mock'ta kimlik bilgisi yok;
    /// senaryo menüsünden gelen oturum bunu belirlemiyor, bu yüzden açık
    /// bırakılıyor ve kısıt yalnız ekranda (izin kontrolüyle) uygulanıyor.
    private let canReopen: Bool

    init(
        catalog: MockCatalogService,
        staff: MockStaffService,
        scheduling: MockSchedulingService,
        customers: MockCustomerService,
        scenario: MockDataScenario = .busyDay,
        canReopen: Bool = true
    ) {
        self.catalog = catalog
        self.staff = staff
        self.scheduling = scheduling
        self.customers = customers
        self.canReopen = canReopen

        let seeded = MockBookingSeed.appointments(
            scenario: scenario,
            services: catalog.snapshotServices,
            profiles: staff.snapshotProfiles,
            customers: customers.snapshot
        )
        appointments = seeded
        for record in seeded {
            histories[record.id] = [MockBookingSeed.creationEntry(for: record)]
        }
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.4) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    /// Geliştirici menüsünden senaryo değiştirildiğinde çağrılır. Müşteri
    /// servisi önce tohumlanmalı — randevular onun kimliklerine bağlanıyor.
    func reseed(_ scenario: MockDataScenario) {
        let seeded = MockBookingSeed.appointments(
            scenario: scenario,
            services: catalog.snapshotServices,
            profiles: staff.snapshotProfiles,
            customers: customers.snapshot
        )
        withLock {
            appointments = seeded
            idempotency = [:]
            histories = seeded.reduce(into: [:]) { result, record in
                result[record.id] = [MockBookingSeed.creationEntry(for: record)]
            }
        }
    }

    // MARK: - Okuma

    func appointments(_ query: AppointmentListQuery) async throws -> Page<CalendarEntry> {
        await latency(0.3)
        let entries = withLock { filtered(query) }
        return Page(data: entries, pageInfo: PageInfo(nextCursor: nil, hasMore: false))
    }

    func appointment(id: String) async throws -> Appointment {
        await latency(0.2)
        return try withLock { try record(id) }
    }

    func history(id: String) async throws -> [AppointmentHistoryEntry] {
        await latency(0.2)
        // Sunucu `order by created_at desc` yapıyor — en yeni olay başta.
        // Mock'ta ekleme sırasında bırakmak, ekranın canlıda ters sırada
        // görünmesi demekti.
        return withLock { (histories[id] ?? []).sorted { $0.createdAt > $1.createdAt } }
    }

    func calendarDay(_ query: CalendarDayQuery) async throws -> CalendarResponse {
        let clock = BranchClock(timeZoneIdentifier: MockBookingSeed.timezone)
        guard let start = clock.date(fromLocalDateString: query.date) else {
            throw MockErrors.validation("Tarih geçersiz", path: "date")
        }
        return try await calendar(
            branchId: query.branchId,
            from: start,
            to: clock.adding(days: 1, to: start),
            staffProfileId: query.staffProfileId
        )
    }

    func calendarWeek(_ query: CalendarWeekQuery) async throws -> CalendarResponse {
        let clock = BranchClock(timeZoneIdentifier: MockBookingSeed.timezone)
        guard let start = clock.date(fromLocalDateString: query.weekStart) else {
            throw MockErrors.validation("Tarih geçersiz", path: "weekStart")
        }
        return try await calendar(
            branchId: query.branchId,
            from: start,
            to: clock.adding(days: 7, to: start),
            staffProfileId: query.staffProfileId
        )
    }

    func calendarStaff(_ query: CalendarStaffQuery) async throws -> CalendarResponse {
        try await calendar(
            branchId: query.branchId,
            from: query.from,
            to: query.to,
            staffProfileId: query.staffProfileId
        )
    }

    private func calendar(
        branchId: String,
        from: Date,
        to: Date,
        staffProfileId: String?
    ) async throws -> CalendarResponse {
        await latency(0.3)
        let clock = BranchClock(timeZoneIdentifier: MockBookingSeed.timezone)
        return withLock {
            let entries = filtered(AppointmentListQuery(
                branchId: branchId,
                from: from,
                to: to,
                staffProfileId: staffProfileId
            ))
            return CalendarResponse(
                branchId: branchId,
                timezone: MockBookingSeed.timezone,
                from: from,
                to: to,
                appointments: entries,
                density: density(of: entries, clock: clock)
            )
        }
    }

    // MARK: - Uygunluk

    func availability(_ query: AvailabilityQuery) async throws -> AvailabilityResponse {
        await latency(0.35)
        let clock = BranchClock(timeZoneIdentifier: MockBookingSeed.timezone)
        let services = try resolveServices(query.serviceIds)
        let span = span(of: services, branchId: query.branchId)

        let candidates = staff.snapshotProfiles.filter { profile in
            guard profile.isActive else { return false }
            if let only = query.staffProfileId, profile.id != only { return false }
            return services.allSatisfy {
                profile.skill(for: $0.id, in: query.branchId) != nil
            }
        }
        guard !candidates.isEmpty else {
            return AvailabilityResponse(
                branchId: query.branchId,
                timezone: MockBookingSeed.timezone,
                slotGranularityMinutes: MockBookingSeed.slotGranularityMinutes,
                slots: []
            )
        }

        let busy = withLock { occupiedRanges(branchId: query.branchId) }
        let step = MockBookingSeed.slotGranularityMinutes
        var slots: [AvailabilitySlot] = []

        var day = clock.startOfDay(query.from)
        while day < query.to {
            let windows = openWindows(on: day, branchId: query.branchId, clock: clock)
            for window in windows {
                // Izgara GÖRÜNEN başlangıç üzerinde ilerler; kullanıcıya
                // gösterilen ve sunucuya gönderilen saat budur.
                var visibleStart = window.start
                while true {
                    let visibleEnd = clock.adding(minutes: span.visibleMinutes, to: visibleStart)
                    // Çalışma saati kontrolünde görünen aralık esas alınır:
                    // kapanıştan sonraya taşan temizlik payı randevuyu
                    // geçersiz kılmaz (sunucudaki kuralın aynısı).
                    if visibleEnd > window.end { break }

                    if visibleStart >= query.from, visibleStart < query.to {
                        let occupiedStart = clock.adding(minutes: -span.leadingBuffer, to: visibleStart)
                        let occupiedEnd = clock.adding(minutes: span.trailingBuffer, to: visibleEnd)
                        let available = candidates.filter { profile in
                            works(
                                profile,
                                at: visibleStart,
                                until: visibleEnd,
                                branchId: query.branchId,
                                clock: clock
                            )
                                && !busy.contains { $0.staffProfileId == profile.id
                                    && $0.start < occupiedEnd && occupiedStart < $0.end }
                        }
                        if !available.isEmpty {
                            slots.append(AvailabilitySlot(
                                startsAt: visibleStart,
                                endsAt: visibleEnd,
                                staffProfileIds: available.map(\.id).sorted()
                            ))
                        }
                    }
                    visibleStart = clock.adding(minutes: step, to: visibleStart)
                }
            }
            day = clock.adding(days: 1, to: day)
        }

        return AvailabilityResponse(
            branchId: query.branchId,
            timezone: MockBookingSeed.timezone,
            slotGranularityMinutes: step,
            slots: slots.sorted { $0.startsAt < $1.startsAt }
        )
    }

    // MARK: - Yazma

    func create(
        _ input: CreateAppointmentInput,
        idempotencyKey: String
    ) async throws -> Appointment {
        await latency()
        let signature = MockBookingSeed.signature(of: input)

        if let existing = try withLock({ () -> Appointment? in
            guard let stored = idempotency[idempotencyKey] else { return nil }
            guard stored.signature == signature else { throw MockErrors.idempotencyConflict }
            return appointments.first { $0.id == stored.appointmentId }
        }) {
            return existing
        }

        let clock = BranchClock(timeZoneIdentifier: MockBookingSeed.timezone)
        guard let startsAt = KlinaraCoding.parseTimestamp(input.startsAt) else {
            throw MockErrors.validation("Başlangıç zamanı geçersiz", path: "startsAt")
        }
        let plan = try buildPlan(
            startsAt: startsAt,
            branchId: input.branchId,
            services: input.services,
            clock: clock
        )

        return try withLock {
            try assertFree(plan, excludingAppointmentId: nil)
            let record = Appointment(
                id: MockIDs.uuid(),
                tenantId: MockIDs.tenant,
                branchId: input.branchId,
                customerId: input.customerId,
                status: .scheduled,
                startsAt: plan.visibleStart,
                endsAt: plan.visibleEnd,
                origin: .internal,
                notes: input.notes,
                cancellationReason: nil,
                version: 1,
                totalMinor: plan.lines.reduce(0) { $0 + $1.priceMinor },
                createdAt: Date(),
                services: plan.lines
            )
            appointments.append(record)
            histories[record.id] = [MockBookingSeed.creationEntry(for: record)]
            idempotency[idempotencyKey] = (signature, record.id)
            return record
        }
    }

    func updateNotes(id: String, version: Int, notes: String?) async throws -> Appointment {
        await latency()
        return try withLock {
            let old = try record(id)
            try assertVersion(version, of: old)
            let updated = old.with(notes: notes, version: old.version + 1)
            try replace(updated)
            append(.updated, to: id, reason: nil)
            return updated
        }
    }

    func reschedule(
        id: String,
        version: Int,
        _ input: RescheduleAppointmentInput
    ) async throws -> Appointment {
        await latency(0.5)
        let clock = BranchClock(timeZoneIdentifier: MockBookingSeed.timezone)
        guard let startsAt = KlinaraCoding.parseTimestamp(input.startsAt) else {
            throw MockErrors.validation("Başlangıç zamanı geçersiz", path: "startsAt")
        }

        let old = try withLock { try record(id) }
        try withLock { try assertVersion(version, of: old) }
        guard old.status.canReschedule else {
            throw MockErrors.invalidTransition(from: old.status, to: old.status)
        }

        // Hizmet dizilimi verilmezse mevcut olan korunur — sunucudaki kural.
        let lineup = input.services ?? old.services
            .sorted { $0.sortOrder < $1.sortOrder }
            .map { AppointmentServiceInput(serviceId: $0.serviceId, staffProfileId: $0.staffProfileId) }
        let plan = try buildPlan(
            startsAt: startsAt,
            branchId: old.branchId,
            services: lineup,
            clock: clock
        )

        return try withLock {
            // Kendi eski slotuyla çakışmamalı: erteleme kendi yerini serbest bırakır.
            try assertFree(plan, excludingAppointmentId: id)
            let updated = old.with(
                startsAt: plan.visibleStart,
                endsAt: plan.visibleEnd,
                services: plan.lines,
                totalMinor: plan.lines.reduce(0) { $0 + $1.priceMinor },
                version: old.version + 1
            )
            try replace(updated)
            append(
                .rescheduled,
                to: id,
                reason: input.reason,
                oldStartsAt: old.startsAt,
                newStartsAt: updated.startsAt
            )
            return updated
        }
    }

    func cancel(id: String, reason: String?) async throws -> Appointment {
        await latency()
        return try withLock {
            let old = try record(id)
            try assertTransition(from: old.status, to: .cancelled)
            let updated = old.with(
                status: .cancelled,
                cancellationReason: reason,
                version: old.version + 1
            )
            try replace(updated)
            append(.cancelled, to: id, reason: reason, from: old.status, to: .cancelled)
            return updated
        }
    }

    func changeStatus(id: String, _ input: ChangeAppointmentStatusInput) async throws -> Appointment {
        await latency(0.3)
        return try withLock {
            let old = try record(id)
            // Aynı duruma geçiş sunucuda 200 no-op; sürüm de artmaz.
            guard old.status != input.status else { return old }
            try assertTransition(from: old.status, to: input.status)
            let updated = old.with(status: input.status, version: old.version + 1)
            try replace(updated)
            append(
                .statusChanged,
                to: id,
                reason: input.reason,
                from: old.status,
                to: input.status
            )
            return updated
        }
    }

    // MARK: - Kural motoru

    /// Zincirlenmiş hizmet planı: görünen aralık, işgal aralığı ve kalemler.
    private struct Plan {
        let branchId: String
        let visibleStart: Date
        let visibleEnd: Date
        /// Buffer dahil, personel bazında işgal edilen aralıklar.
        let occupied: [(staffProfileId: String, start: Date, end: Date)]
        let lines: [AppointmentServiceLine]
    }

    private func buildPlan(
        startsAt: Date,
        branchId: String,
        services inputs: [AppointmentServiceInput],
        clock: BranchClock
    ) throws -> Plan {
        guard !inputs.isEmpty else {
            throw MockErrors.validation("En az bir hizmet seçilmeli", path: "services")
        }
        let catalogServices = catalog.snapshotServices
        let profiles = staff.snapshotProfiles

        var lines: [AppointmentServiceLine] = []
        var occupied: [(staffProfileId: String, start: Date, end: Date)] = []
        // `cursor` GÖRÜNEN başlangıçtır. Sunucuya gönderilen saat müşterinin
        // gördüğü saattir; hazırlık payı onun ÖNÜNE eklenir, sonrasına değil.
        // Tersini yapmak randevuyu buffer kadar ileri kaydırırdı.
        var cursor = startsAt

        for (index, input) in inputs.enumerated() {
            guard let service = catalogServices.first(where: { $0.id == input.serviceId }),
                  service.isActive
            else { throw MockErrors.notFoundService }
            guard let profile = profiles.first(where: { $0.id == input.staffProfileId }),
                  profile.isActive
            else { throw MockErrors.notFoundStaff }
            guard profile.skill(for: service.id, in: branchId) != nil else {
                throw MockErrors.incompetent(profile.userFullName, service.name)
            }

            let effective = service.effective(in: branchId)
            let visibleFinish = clock.adding(minutes: effective.durationMinutes, to: cursor)

            lines.append(AppointmentServiceLine(
                id: MockIDs.uuid(),
                serviceId: service.id,
                staffProfileId: profile.id,
                sortOrder: index,
                startsAt: cursor,
                endsAt: visibleFinish,
                durationMinutes: effective.durationMinutes,
                bufferBeforeMinutes: effective.bufferBeforeMinutes,
                bufferAfterMinutes: effective.bufferAfterMinutes,
                priceMinor: effective.priceMinor,
                vatRateBasisPoints: effective.vatRateBasisPoints
            ))
            occupied.append((
                profile.id,
                clock.adding(minutes: -effective.bufferBeforeMinutes, to: cursor),
                clock.adding(minutes: effective.bufferAfterMinutes, to: visibleFinish)
            ))

            // Bir sonraki hizmet, bu hizmetin temizlik payı ve kendi hazırlık
            // payı kadar sonra başlar.
            let nextBefore = index + 1 < inputs.count
                ? (catalogServices.first { $0.id == inputs[index + 1].serviceId }?
                    .effective(in: branchId).bufferBeforeMinutes ?? 0)
                : 0
            cursor = clock.adding(
                minutes: effective.bufferAfterMinutes + nextBefore,
                to: visibleFinish
            )
        }

        return Plan(
            branchId: branchId,
            visibleStart: startsAt,
            visibleEnd: lines.last?.endsAt ?? startsAt,
            occupied: occupied,
            lines: lines
        )
    }

    /// Zincirin görünen ve işgal edilen süreleri — uygunluk ızgarası bunlara
    /// göre kuruluyor, ``buildPlan`` ile aynı aritmetiği kullanmak zorunda.
    private struct Span {
        /// İlk hizmetin hazırlık payı — işgal görünen başlangıçtan bu kadar önce başlar.
        let leadingBuffer: Int
        /// Son hizmetin temizlik payı.
        let trailingBuffer: Int
        /// Görünen ilk başlangıçtan görünen son bitişe kadar (aradaki paylar dahil).
        let visibleMinutes: Int
    }

    private func span(of services: [ClinicService], branchId: String) -> Span {
        let effective = services.map { $0.effective(in: branchId) }
        var visible = effective.reduce(0) { $0 + $1.durationMinutes }
        for index in 1..<max(effective.count, 1) where effective.count > 1 {
            visible += effective[index - 1].bufferAfterMinutes + effective[index].bufferBeforeMinutes
        }
        return Span(
            leadingBuffer: effective.first?.bufferBeforeMinutes ?? 0,
            trailingBuffer: effective.last?.bufferAfterMinutes ?? 0,
            visibleMinutes: visible
        )
    }

    /// Çakışma kontrolü. Sunucuda bunu bir `EXCLUDE` constraint yapıyor;
    /// burada elle, **aynı yarı-açık aralık semantiğiyle** (`[)`): sırt sırada
    /// randevular çakışmaz, buffer'lar kesişiyorsa çakışır.
    private func assertFree(_ plan: Plan, excludingAppointmentId: String?) throws {
        let busy = occupiedRanges(branchId: plan.branchId)
            .filter { $0.appointmentId != excludingAppointmentId }

        var conflicts: [SlotConflict] = []
        for block in plan.occupied {
            for other in busy where other.staffProfileId == block.staffProfileId {
                if other.start < block.end, block.start < other.end {
                    conflicts.append(SlotConflict(
                        resourceType: "staff",
                        resourceId: other.staffProfileId,
                        appointmentId: other.appointmentId,
                        from: other.start,
                        to: other.end
                    ))
                }
            }
        }
        guard conflicts.isEmpty else {
            throw MockErrors.slotConflict(
                conflicts: conflicts,
                suggestions: suggestions(for: plan, avoiding: busy)
            )
        }
    }

    /// İstenen saate en yakın üç boş alternatif, ±12 saat içinde.
    private func suggestions(
        for plan: Plan,
        avoiding busy: [OccupiedRange]
    ) -> [SlotSuggestion] {
        let clock = BranchClock(timeZoneIdentifier: MockBookingSeed.timezone)
        let visibleMinutes = clock.minutes(from: plan.visibleStart, to: plan.visibleEnd)
        let leading = plan.occupied.first.map { clock.minutes(from: $0.start, to: plan.visibleStart) } ?? 0
        let trailing = plan.occupied.last.map { clock.minutes(from: plan.visibleEnd, to: $0.end) } ?? 0
        let staffIds = Set(plan.occupied.map(\.staffProfileId))
        let step = MockBookingSeed.slotGranularityMinutes

        var found: [SlotSuggestion] = []
        // Merkeze en yakından uzağa: -1, +1, -2, +2 … sunucudaki sıralamanın karşılığı.
        for distance in 1...(12 * 60 / step) {
            for direction in [-1, 1] {
                let candidate = clock.adding(
                    minutes: direction * distance * step,
                    to: plan.visibleStart
                )
                let candidateEnd = clock.adding(minutes: visibleMinutes, to: candidate)
                let occupiedStart = clock.adding(minutes: -leading, to: candidate)
                let occupiedEnd = clock.adding(minutes: trailing, to: candidateEnd)

                let free = !busy.contains {
                    staffIds.contains($0.staffProfileId)
                        && $0.start < occupiedEnd && occupiedStart < $0.end
                }
                let inHours = openWindows(
                    on: clock.startOfDay(candidate),
                    branchId: plan.branchId,
                    clock: clock
                ).contains { candidate >= $0.start && candidateEnd <= $0.end }

                if free, inHours {
                    found.append(SlotSuggestion(
                        startsAt: candidate,
                        endsAt: candidateEnd,
                        staffProfileIds: staffIds.sorted()
                    ))
                    if found.count == 3 { return found }
                }
            }
        }
        return found
    }

    private func assertTransition(from: AppointmentStatus, to: AppointmentStatus) throws {
        // `completed`tan çıkış `appointment:reopen` ister.
        if from == .completed, !canReopen {
            throw MockErrors.forbidden("appointment:reopen")
        }
        guard from.allowedTransitions(canReopen: canReopen).contains(to) else {
            throw MockErrors.invalidTransition(from: from, to: to)
        }
    }

    private func assertVersion(_ version: Int, of record: Appointment) throws {
        guard version == record.version else { throw MockErrors.versionConflict }
    }

    // MARK: - Depo yardımcıları

    private typealias OccupiedRange = (
        appointmentId: String, staffProfileId: String, start: Date, end: Date
    )

    /// Aktif randevuların işgal ettiği aralıklar. Sonlanmış randevular
    /// (iptal / gelmedi) slotu bırakır — sunucudaki kısmi indeksin karşılığı.
    private func occupiedRanges(branchId: String) -> [OccupiedRange] {
        let clock = BranchClock(timeZoneIdentifier: MockBookingSeed.timezone)
        return appointments
            .filter { $0.branchId == branchId && !$0.status.isTerminal }
            .flatMap { record in
                record.services.map { line in
                    (
                        record.id,
                        line.staffProfileId,
                        clock.adding(minutes: -line.bufferBeforeMinutes, to: line.startsAt),
                        clock.adding(minutes: line.bufferAfterMinutes, to: line.endsAt)
                    )
                }
            }
    }

    private func record(_ id: String) throws -> Appointment {
        guard let match = appointments.first(where: { $0.id == id }) else {
            throw MockErrors.notFound
        }
        return match
    }

    private func replace(_ record: Appointment) throws {
        guard let index = appointments.firstIndex(where: { $0.id == record.id }) else {
            throw MockErrors.notFound
        }
        appointments[index] = record
    }

    private func append(
        _ action: AppointmentHistoryAction,
        to id: String,
        reason: String?,
        from: AppointmentStatus? = nil,
        to toStatus: AppointmentStatus? = nil,
        oldStartsAt: Date? = nil,
        newStartsAt: Date? = nil
    ) {
        histories[id, default: []].append(AppointmentHistoryEntry(
            id: MockIDs.uuid(),
            action: action,
            actorUserId: MockIDs.userOwner,
            fromStatus: from,
            toStatus: toStatus,
            oldStartsAt: oldStartsAt,
            newStartsAt: newStartsAt,
            reason: reason,
            createdAt: Date()
        ))
    }

    private func filtered(_ query: AppointmentListQuery) -> [CalendarEntry] {
        let services = catalog.snapshotServices
        let customerRecords = customers.snapshot
        return appointments
            .filter { record in
                if let branchId = query.branchId, record.branchId != branchId { return false }
                if let customerId = query.customerId, record.customerId != customerId { return false }
                if let staffProfileId = query.staffProfileId,
                   !record.services.contains(where: { $0.staffProfileId == staffProfileId }) {
                    return false
                }
                if !query.status.isEmpty, !query.status.contains(record.status) { return false }
                return record.startsAt < query.to && record.endsAt > query.from
            }
            .sorted { $0.startsAt < $1.startsAt }
            .map { $0.calendarEntry(services: services, customers: customerRecords) }
    }

    private func density(of entries: [CalendarEntry], clock: BranchClock) -> [DensityBucket] {
        var counts: [String: Int] = [:]
        for entry in entries where !entry.status.isTerminal {
            let hour = clock.minutesFromMidnight(entry.startsAt) / 60
            counts["\(clock.localDateString(entry.startsAt))#\(hour)", default: 0] += 1
        }
        return counts
            .compactMap { key, count in
                let parts = key.split(separator: "#")
                guard parts.count == 2, let hour = Int(parts[1]) else { return nil }
                return DensityBucket(
                    localDay: String(parts[0]),
                    localHour: hour,
                    appointmentCount: count
                )
            }
            .sorted { ($0.localDay, $0.localHour) < ($1.localDay, $1.localHour) }
    }

    private func resolveServices(_ ids: [String]) throws -> [ClinicService] {
        let all = catalog.snapshotServices
        return try ids.map { id in
            guard let service = all.first(where: { $0.id == id }), service.isActive else {
                throw MockErrors.notFoundService
            }
            return service
        }
    }

    // MARK: - Çalışma saatleri

    private struct Window { let start: Date; let end: Date }

    /// Şubenin o gün açık olduğu aralıklar — mola çıkarılmış hâlde.
    private func openWindows(on day: Date, branchId: String, clock: BranchClock) -> [Window] {
        let weekday = Calendar(identifier: .gregorian).with(timeZone: clock.timeZone)
            .component(.weekday, from: day) - 1
        guard let hours = scheduling.snapshotHours(branchId: branchId)
            .first(where: { $0.dayOfWeek == weekday }),
            !hours.isClosed,
            let open = ClockTime(hours.openTime),
            let close = ClockTime(hours.closeTime)
        else { return [] }

        let start = clock.date(on: day, at: open)
        let end = clock.date(on: day, at: close)
        guard let breakStart = ClockTime(hours.breakStartTime),
              let breakEnd = ClockTime(hours.breakEndTime)
        else { return [Window(start: start, end: end)] }

        return [
            Window(start: start, end: clock.date(on: day, at: breakStart)),
            Window(start: clock.date(on: day, at: breakEnd), end: end),
        ]
    }

    /// Personel o aralıkta çalışıyor mu — haftalık şablon + izin istisnaları.
    private func works(
        _ profile: StaffProfile,
        at start: Date,
        until end: Date,
        branchId: String,
        clock: BranchClock
    ) -> Bool {
        let weekday = Calendar(identifier: .gregorian).with(timeZone: clock.timeZone)
            .component(.weekday, from: start) - 1
        let template = scheduling.snapshotSchedule(staffProfileId: profile.id, branchId: branchId)

        // Şablon hiç kurulmamışsa personel şubenin saatlerine tabidir —
        // sunucu da eksik şablonu "kısıt yok" saymıyor ama mock'ta bu, henüz
        // takvimi girilmemiş personeli görünmez kılmamak için bilinçli.
        if !template.isEmpty {
            guard let entry = template.first(where: { $0.dayOfWeek == weekday }),
                  !entry.isOff,
                  let from = ClockTime(entry.startTime),
                  let to = ClockTime(entry.endTime),
                  start >= clock.date(on: start, at: from),
                  end <= clock.date(on: start, at: to)
            else { return false }
        }

        let onLeave = scheduling.snapshotExceptions().contains {
            $0.staffProfileId == profile.id && $0.startsAt < end && start < $0.endsAt
        }
        return !onLeave
    }
}

private extension Calendar {
    func with(timeZone: TimeZone) -> Calendar {
        var copy = self
        copy.timeZone = timeZone
        return copy
    }
}
