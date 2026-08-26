import Foundation

/// Şube saatleri, personel şablonu ve istisna uçları (Batch 2.3).
///
/// **Hepsi `@RequireBranchScope`'tur:** `X-Branch-Id` başlığı olmadan sunucu
/// `400 VALIDATION_FAILED` döner. Başlığı ``APIClient`` ekler, ekranlar
/// yalnız seçili şubenin doğru olduğundan sorumludur.
protocol SchedulingService: Sendable {

    /// `GET /branches/:id/hours`
    func branchHours(branchId: String) async throws -> BranchHours

    /// `PUT /branches/:id/hours` — haftanın tamamını değiştirir.
    func replaceBranchHours(branchId: String, entries: [BranchHourInput]) async throws -> BranchHours

    /// `GET /staff/:id/schedule?branchId=`
    func staffSchedule(staffProfileId: String, branchId: String) async throws -> StaffSchedule

    /// `PUT /staff/:id/schedule`
    func replaceStaffSchedule(
        staffProfileId: String,
        branchId: String,
        entries: [StaffScheduleEntryInput]
    ) async throws -> StaffSchedule

    /// `GET /schedule-exceptions`
    func scheduleExceptions(_ query: ScheduleExceptionQuery) async throws -> [ScheduleException]

    /// `POST /schedule-exceptions`
    func createScheduleException(_ input: ScheduleExceptionInput) async throws -> ScheduleException

    /// `DELETE /schedule-exceptions/:id` — pasife alır, `204` döner.
    func deleteScheduleException(id: String) async throws
}

struct LiveSchedulingService: SchedulingService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func branchHours(branchId: String) async throws -> BranchHours {
        try await client.send(APIRequest.get("branches/\(branchId)/hours"))
    }

    func replaceBranchHours(
        branchId: String,
        entries: [BranchHourInput]
    ) async throws -> BranchHours {
        try await client.send(APIRequest.put(
            "branches/\(branchId)/hours",
            body: PutBranchHoursInput(entries: entries)
        ))
    }

    func staffSchedule(staffProfileId: String, branchId: String) async throws -> StaffSchedule {
        try await client.send(APIRequest.get(
            "staff/\(staffProfileId)/schedule",
            query: [URLQueryItem(name: "branchId", value: branchId)]
        ))
    }

    func replaceStaffSchedule(
        staffProfileId: String,
        branchId: String,
        entries: [StaffScheduleEntryInput]
    ) async throws -> StaffSchedule {
        try await client.send(APIRequest.put(
            "staff/\(staffProfileId)/schedule",
            body: PutStaffScheduleInput(branchId: branchId, entries: entries)
        ))
    }

    func scheduleExceptions(_ query: ScheduleExceptionQuery) async throws -> [ScheduleException] {
        var items = [URLQueryItem(name: "branchId", value: query.branchId)]
        if let staffProfileId = query.staffProfileId {
            items.append(URLQueryItem(name: "staffProfileId", value: staffProfileId))
        }
        if let from = query.from {
            items.append(URLQueryItem(name: "from", value: KlinaraCoding.timestamp(from)))
        }
        if let to = query.to {
            items.append(URLQueryItem(name: "to", value: KlinaraCoding.timestamp(to)))
        }
        let response: ListEnvelope<ScheduleException> = try await client.send(
            APIRequest.get("schedule-exceptions", query: items)
        )
        return response.data
    }

    func createScheduleException(_ input: ScheduleExceptionInput) async throws -> ScheduleException {
        try await client.send(APIRequest.post("schedule-exceptions", body: input))
    }

    func deleteScheduleException(id: String) async throws {
        try await client.send(APIRequest.delete("schedule-exceptions/\(id)"))
    }
}
