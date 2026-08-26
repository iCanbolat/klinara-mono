import Foundation

/// Bellek-içi çalışma takvimi.
final class MockSchedulingService: SchedulingService, @unchecked Sendable {

    private let lock = NSLock()
    /// Şube kimliği → haftalık saatler.
    private var hours: [String: [BranchHour]] = [:]
    /// "profil|şube" → haftalık şablon.
    private var schedules: [String: [StaffScheduleEntry]] = [:]
    private var exceptions: [ScheduleException] = []

    init() {
        let now = Date()
        hours[MockIDs.branchNisantasi] = MockSchedulingSeed.branchHours(
            branchId: MockIDs.branchNisantasi, at: now
        )
        hours[MockIDs.branchBagdat] = MockSchedulingSeed.branchHours(
            branchId: MockIDs.branchBagdat, at: now
        )
        schedules[Self.key(MockStaffSeed.profileAyse, MockIDs.branchNisantasi)] =
            MockSchedulingSeed.staffSchedule(
                staffProfileId: MockStaffSeed.profileAyse,
                branchId: MockIDs.branchNisantasi,
                at: now
            )
        exceptions = MockSchedulingSeed.exceptions(at: now)
    }

    private static func key(_ staffProfileId: String, _ branchId: String) -> String {
        "\(staffProfileId)|\(branchId)"
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.35) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    // MARK: - Şube saatleri

    func branchHours(branchId: String) async throws -> BranchHours {
        await latency()
        return withLock {
            BranchHours(branchId: branchId, entries: hours[branchId] ?? [])
        }
    }

    func replaceBranchHours(
        branchId: String,
        entries: [BranchHourInput]
    ) async throws -> BranchHours {
        await latency(0.5)
        return withLock {
            let stored = entries.map { input in
                BranchHour(
                    id: MockIDs.uuid(), tenantId: MockIDs.tenant, branchId: branchId,
                    dayOfWeek: input.dayOfWeek,
                    isClosed: input.isClosed ?? false,
                    // Sunucu saniyeli döndürür; mock da öyle yapmazsa arayüzün
                    // "09:00:00" ayrıştırması yalnız canlıda sınanmış olur.
                    openTime: ClockTime.serverFormatted(input.openTime),
                    closeTime: ClockTime.serverFormatted(input.closeTime),
                    breakStartTime: ClockTime.serverFormatted(input.breakStartTime),
                    breakEndTime: ClockTime.serverFormatted(input.breakEndTime),
                    createdAt: Date()
                )
            }
            hours[branchId] = stored
            return BranchHours(branchId: branchId, entries: stored)
        }
    }

    // MARK: - Personel şablonu

    func staffSchedule(staffProfileId: String, branchId: String) async throws -> StaffSchedule {
        await latency()
        return withLock {
            StaffSchedule(
                staffProfileId: staffProfileId,
                branchId: branchId,
                entries: schedules[Self.key(staffProfileId, branchId)] ?? []
            )
        }
    }

    func replaceStaffSchedule(
        staffProfileId: String,
        branchId: String,
        entries: [StaffScheduleEntryInput]
    ) async throws -> StaffSchedule {
        await latency(0.5)
        return withLock {
            let stored = entries.map { input in
                StaffScheduleEntry(
                    id: MockIDs.uuid(), tenantId: MockIDs.tenant,
                    staffProfileId: staffProfileId, branchId: branchId,
                    dayOfWeek: input.dayOfWeek,
                    isOff: input.isOff ?? false,
                    startTime: ClockTime.serverFormatted(input.startTime),
                    endTime: ClockTime.serverFormatted(input.endTime),
                    createdAt: Date()
                )
            }
            schedules[Self.key(staffProfileId, branchId)] = stored
            return StaffSchedule(staffProfileId: staffProfileId, branchId: branchId, entries: stored)
        }
    }

    // MARK: - İstisnalar

    func scheduleExceptions(_ query: ScheduleExceptionQuery) async throws -> [ScheduleException] {
        await latency()
        return withLock {
            exceptions
                .filter { $0.isActive && $0.branchId == query.branchId }
                .filter { query.staffProfileId == nil || $0.staffProfileId == query.staffProfileId }
                .filter { query.from == nil || $0.endsAt >= query.from! }
                .filter { query.to == nil || $0.startsAt <= query.to! }
                .sorted { $0.startsAt < $1.startsAt }
        }
    }

    func createScheduleException(_ input: ScheduleExceptionInput) async throws -> ScheduleException {
        await latency(0.5)
        guard
            let startsAt = KlinaraCoding.parseTimestamp(input.startsAt),
            let endsAt = KlinaraCoding.parseTimestamp(input.endsAt)
        else {
            throw APIError.problem(ProblemDetails(
                code: .validationFailed,
                title: "Geçersiz tarih",
                status: 400,
                errors: [FieldError(path: "startsAt", message: "Geçerli bir tarih girin")]
            ))
        }

        return withLock {
            let created = ScheduleException(
                id: MockIDs.uuid(), tenantId: MockIDs.tenant,
                staffProfileId: input.staffProfileId, branchId: input.branchId,
                startsAt: startsAt, endsAt: endsAt, reason: input.reason,
                recurrenceType: input.recurrenceType ?? .none,
                recurrenceIntervalWeeks: input.recurrenceIntervalWeeks ?? 1,
                recurrenceUntil: input.recurrenceUntil.flatMap(KlinaraCoding.parseTimestamp),
                recurrenceWeekdays: input.recurrenceWeekdays ?? [],
                isActive: input.isActive ?? true,
                createdAt: Date()
            )
            exceptions.append(created)
            return created
        }
    }

    func deleteScheduleException(id: String) async throws {
        await latency(0.3)
        withLock {
            guard let index = exceptions.firstIndex(where: { $0.id == id }) else { return }
            let old = exceptions[index]
            // Sunucu satırı SİLMEZ, `is_active = false` yapar. Mock da öyle yapar
            // ki "sildim ama hâlâ bir yerde duruyor" davranışı burada da görünsün.
            exceptions[index] = ScheduleException(
                id: old.id, tenantId: old.tenantId, staffProfileId: old.staffProfileId,
                branchId: old.branchId, startsAt: old.startsAt, endsAt: old.endsAt,
                reason: old.reason, recurrenceType: old.recurrenceType,
                recurrenceIntervalWeeks: old.recurrenceIntervalWeeks,
                recurrenceUntil: old.recurrenceUntil, recurrenceWeekdays: old.recurrenceWeekdays,
                isActive: false, createdAt: old.createdAt
            )
        }
    }
}

enum MockSchedulingSeed {

    static func branchHours(branchId: String, at now: Date) -> [BranchHour] {
        Weekday.allCases.map { day in
            let closed = day == .sunday
            return BranchHour(
                id: MockIDs.uuid(), tenantId: MockIDs.tenant, branchId: branchId,
                dayOfWeek: day.rawValue,
                isClosed: closed,
                openTime: closed ? nil : "09:00:00",
                closeTime: closed ? nil : (day == .saturday ? "16:00:00" : "19:00:00"),
                breakStartTime: closed ? nil : "13:00:00",
                breakEndTime: closed ? nil : "14:00:00",
                createdAt: now
            )
        }
    }

    static func staffSchedule(
        staffProfileId: String,
        branchId: String,
        at now: Date
    ) -> [StaffScheduleEntry] {
        Weekday.allCases.map { day in
            let off = day == .sunday || day == .wednesday
            return StaffScheduleEntry(
                id: MockIDs.uuid(), tenantId: MockIDs.tenant,
                staffProfileId: staffProfileId, branchId: branchId,
                dayOfWeek: day.rawValue,
                isOff: off,
                startTime: off ? nil : "10:00:00",
                endTime: off ? nil : "18:00:00",
                createdAt: now
            )
        }
    }

    static func exceptions(at now: Date) -> [ScheduleException] {
        let calendar = Calendar(identifier: .gregorian)
        let nextWeek = calendar.date(byAdding: .day, value: 7, to: now) ?? now
        return [
            ScheduleException(
                id: MockIDs.uuid(), tenantId: MockIDs.tenant,
                staffProfileId: MockStaffSeed.profileAyse, branchId: MockIDs.branchNisantasi,
                startsAt: nextWeek,
                endsAt: calendar.date(byAdding: .day, value: 3, to: nextWeek) ?? nextWeek,
                reason: "Yıllık izin",
                recurrenceType: .none, recurrenceIntervalWeeks: 1,
                recurrenceUntil: nil, recurrenceWeekdays: [],
                isActive: true, createdAt: now
            )
        ]
    }
}
