import Foundation

/// Takvim çekirdeğinin uçları — `apps/api/src/modules/booking`.
///
/// Şube kapsamı iki farklı şekilde geçer ve karıştırılmamalıdır: `availability`
/// ve `calendar/*` uçları `@RequireBranchScope`'tur (`X-Branch-Id` başlığı
/// ``APIClient`` tarafından her istekte gönderilir), randevu uçları ise şubeyi
/// **gövdede/sorguda** alır.
protocol BookingService: Sendable {

    /// `GET /availability` — verilen hizmet dizisi için uygun slotlar.
    func availability(_ query: AvailabilityQuery) async throws -> AvailabilityResponse

    /// `GET /appointments` — filtreli, cursor sayfalamalı liste.
    func appointments(_ query: AppointmentListQuery) async throws -> Page<CalendarEntry>

    /// `GET /appointments/:id`
    func appointment(id: String) async throws -> Appointment

    /// `GET /appointments/:id/history`
    func history(id: String) async throws -> [AppointmentHistoryEntry]

    /// `POST /appointments` — `Idempotency-Key` ile tekrar güvenli.
    func create(
        _ input: CreateAppointmentInput,
        idempotencyKey: String
    ) async throws -> Appointment

    /// `PATCH /appointments/:id` — yalnız notu değiştirir, `If-Match` zorunlu.
    ///
    /// `notes` opsiyonel değil: `nil` göndermek notu **siler**, sunucudaki
    /// davranışın aynısı. Mevcut notu korumak isteyen onu geri göndermeli.
    func updateNotes(id: String, version: Int, notes: String?) async throws -> Appointment

    /// `POST /appointments/:id/reschedule` — `If-Match` zorunlu.
    func reschedule(
        id: String,
        version: Int,
        _ input: RescheduleAppointmentInput
    ) async throws -> Appointment

    /// `POST /appointments/:id/cancel` — `If-Match` **almaz**, sürümü sunucu okur.
    func cancel(id: String, reason: String?) async throws -> Appointment

    /// `POST /appointments/:id/status`
    func changeStatus(id: String, _ input: ChangeAppointmentStatusInput) async throws -> Appointment

    /// `GET /calendar/day` — `X-Branch-Id` zorunlu.
    func calendarDay(_ query: CalendarDayQuery) async throws -> CalendarResponse

    /// `GET /calendar/week` — `X-Branch-Id` zorunlu.
    func calendarWeek(_ query: CalendarWeekQuery) async throws -> CalendarResponse

    /// `GET /calendar/staff` — `X-Branch-Id` zorunlu.
    func calendarStaff(_ query: CalendarStaffQuery) async throws -> CalendarResponse
}

struct LiveBookingService: BookingService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    // MARK: Uygunluk

    func availability(_ query: AvailabilityQuery) async throws -> AvailabilityResponse {
        var items = [
            URLQueryItem(name: "branchId", value: query.branchId),
            // Sunucu hem `a,b` hem tekrarlı parametreyi kabul ediyor; virgüllü
            // biçim URL'i kısa tutar ve sırayı gözle doğrulanabilir kılar.
            URLQueryItem(name: "serviceIds", value: query.serviceIds.joined(separator: ",")),
            URLQueryItem(name: "from", value: KlinaraCoding.timestamp(query.from)),
            URLQueryItem(name: "to", value: KlinaraCoding.timestamp(query.to)),
        ]
        if let staffProfileId = query.staffProfileId {
            items.append(URLQueryItem(name: "staffProfileId", value: staffProfileId))
        }
        return try await client.send(APIRequest.get("availability", query: items))
    }

    // MARK: Randevu

    func appointments(_ query: AppointmentListQuery) async throws -> Page<CalendarEntry> {
        var items = [
            URLQueryItem(name: "from", value: KlinaraCoding.timestamp(query.from)),
            URLQueryItem(name: "to", value: KlinaraCoding.timestamp(query.to)),
        ]
        if let branchId = query.branchId {
            items.append(URLQueryItem(name: "branchId", value: branchId))
        }
        if let customerId = query.customerId {
            items.append(URLQueryItem(name: "customerId", value: customerId))
        }
        if let staffProfileId = query.staffProfileId {
            items.append(URLQueryItem(name: "staffProfileId", value: staffProfileId))
        }
        if !query.status.isEmpty {
            let raw = query.status.map(\.rawValue).joined(separator: ",")
            items.append(URLQueryItem(name: "status", value: raw))
        }
        if let limit = query.limit {
            items.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        if let cursor = query.cursor {
            items.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return try await client.send(APIRequest.get("appointments", query: items))
    }

    func appointment(id: String) async throws -> Appointment {
        try await client.send(APIRequest.get("appointments/\(id)"))
    }

    func history(id: String) async throws -> [AppointmentHistoryEntry] {
        let response: ListEnvelope<AppointmentHistoryEntry> = try await client.send(
            APIRequest.get("appointments/\(id)/history")
        )
        return response.data
    }

    func create(
        _ input: CreateAppointmentInput,
        idempotencyKey: String
    ) async throws -> Appointment {
        try await client.send(
            APIRequest.post("appointments", body: input, idempotencyKey: idempotencyKey)
        )
    }

    func updateNotes(id: String, version: Int, notes: String?) async throws -> Appointment {
        try await client.send(
            APIRequest.patch(
                "appointments/\(id)",
                body: UpdateAppointmentInput(notes: notes),
                ifMatch: weakETag(version)
            )
        )
    }

    func reschedule(
        id: String,
        version: Int,
        _ input: RescheduleAppointmentInput
    ) async throws -> Appointment {
        try await client.send(
            APIRequest.post(
                "appointments/\(id)/reschedule",
                body: input,
                ifMatch: weakETag(version)
            )
        )
    }

    func cancel(id: String, reason: String?) async throws -> Appointment {
        try await client.send(
            APIRequest.post("appointments/\(id)/cancel", body: CancelAppointmentInput(reason: reason))
        )
    }

    func changeStatus(id: String, _ input: ChangeAppointmentStatusInput) async throws -> Appointment {
        try await client.send(APIRequest.post("appointments/\(id)/status", body: input))
    }

    // MARK: Takvim

    func calendarDay(_ query: CalendarDayQuery) async throws -> CalendarResponse {
        var items = [
            URLQueryItem(name: "branchId", value: query.branchId),
            URLQueryItem(name: "date", value: query.date),
        ]
        if let staffProfileId = query.staffProfileId {
            items.append(URLQueryItem(name: "staffProfileId", value: staffProfileId))
        }
        return try await client.send(APIRequest.get("calendar/day", query: items))
    }

    func calendarWeek(_ query: CalendarWeekQuery) async throws -> CalendarResponse {
        var items = [
            URLQueryItem(name: "branchId", value: query.branchId),
            URLQueryItem(name: "weekStart", value: query.weekStart),
        ]
        if let staffProfileId = query.staffProfileId {
            items.append(URLQueryItem(name: "staffProfileId", value: staffProfileId))
        }
        return try await client.send(APIRequest.get("calendar/week", query: items))
    }

    func calendarStaff(_ query: CalendarStaffQuery) async throws -> CalendarResponse {
        let items = [
            URLQueryItem(name: "branchId", value: query.branchId),
            URLQueryItem(name: "staffProfileId", value: query.staffProfileId),
            URLQueryItem(name: "from", value: KlinaraCoding.timestamp(query.from)),
            URLQueryItem(name: "to", value: KlinaraCoding.timestamp(query.to)),
        ]
        return try await client.send(APIRequest.get("calendar/staff", query: items))
    }
}
