import Foundation

/// Bellekte yaşayan not servisi.
///
/// İki davranışı sunucudan aynen taşıyor, çünkü ekranlar bunlara dayanıyor:
/// 1. **Revizyon trigger'ı** — metin değişince eski gövde saklanır ve `version`
///    artar. Sadece `updatedAt` tazelemek, "düzenlendi" işaretini yalan yapardı.
/// 2. **Görünürlük SQL'de daralır** — klinik notlar izinsiz kullanıcıya
///    listeden hiç çıkmaz, tek tek elenmez.
///
/// Zaman çizelgesi randevuları ``MockBookingService``'ten okuyor: iki mock ayrı
/// ayrı tohumlansaydı aynı müşterinin randevusu kartta hiç görünmezdi.
final class MockNotesService: NotesService, @unchecked Sendable {

    private let lock = NSLock()
    private var records: [CustomerNote] = []
    private var revisionRecords: [String: [CustomerNoteRevision]] = [:]

    private let booking: MockBookingService
    /// İstemcinin izni — mock'ta oturum yok, senaryo bunu dışarıdan veriyor.
    private var canReadMedical: Bool

    init(booking: MockBookingService, canReadMedical: Bool = true) {
        self.booking = booking
        self.canReadMedical = canReadMedical
        records = MockNoteSeed.notes(at: MockNow.reference)
    }

    func reseed(canReadMedical: Bool) {
        withLock {
            self.canReadMedical = canReadMedical
            records = MockNoteSeed.notes(at: MockNow.reference)
            revisionRecords = [:]
        }
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.3) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    // MARK: Okuma

    func notes(customerId: String) async throws -> [CustomerNote] {
        await latency()
        return withLock {
            visible(records)
                .filter { $0.customerId == customerId }
                .sorted { $0.createdAt > $1.createdAt }
        }
    }

    func revisions(noteId: String) async throws -> [CustomerNoteRevision] {
        await latency(0.2)
        return try withLock {
            // Göremeyeceği notun geçmişi de yok — 404, 403 değil.
            guard visible(records).contains(where: { $0.id == noteId }) else {
                throw MockErrors.notFound
            }
            return (revisionRecords[noteId] ?? []).sorted { $0.editedAt > $1.editedAt }
        }
    }

    // MARK: Yazma

    func create(customerId: String, _ input: CreateNoteInput) async throws -> CustomerNote {
        await latency(0.4)
        return try withLock {
            try assertCanWrite(input.kind)
            let now = MockNow.next()
            let note = CustomerNote(
                id: MockIDs.uuid(),
                customerId: customerId,
                appointmentId: input.appointmentId,
                kind: input.kind,
                body: input.body.trimmingCharacters(in: .whitespacesAndNewlines),
                customerVisible: input.customerVisible ?? false,
                authorUserId: MockIDs.userOwner,
                version: 1,
                createdAt: now,
                updatedAt: now
            )
            records.append(note)
            return note
        }
    }

    func update(noteId: String, _ input: UpdateNoteInput) async throws -> CustomerNote {
        await latency(0.4)
        return try withLock {
            guard let index = records.firstIndex(where: { $0.id == noteId }),
                  visible(records).contains(where: { $0.id == noteId })
            else { throw MockErrors.notFound }

            let old = records[index]
            // Göremediği notu düzenleyemez de.
            try assertCanWrite(old.kind)
            if let kind = input.kind { try assertCanWrite(kind) }

            let nextBody = input.body?.trimmingCharacters(in: .whitespacesAndNewlines) ?? old.body
            let textChanged = nextBody != old.body

            if textChanged {
                // TRIGGER'ın işi: eski gövde saklanır, sürüm artar.
                revisionRecords[noteId, default: []].append(CustomerNoteRevision(
                    id: MockIDs.uuid(),
                    body: old.body,
                    version: old.version,
                    editedBy: MockIDs.userOwner,
                    editedAt: MockNow.next()
                ))
            }

            let updated = CustomerNote(
                id: old.id,
                customerId: old.customerId,
                appointmentId: old.appointmentId,
                kind: input.kind ?? old.kind,
                body: nextBody,
                customerVisible: input.customerVisible ?? old.customerVisible,
                authorUserId: old.authorUserId,
                version: textChanged ? old.version + 1 : old.version,
                createdAt: old.createdAt,
                updatedAt: MockNow.next()
            )
            records[index] = updated
            return updated
        }
    }

    func delete(noteId: String) async throws {
        await latency(0.3)
        try withLock {
            guard let index = records.firstIndex(where: { $0.id == noteId }),
                  visible(records).contains(where: { $0.id == noteId })
            else { throw MockErrors.notFound }
            try assertCanWrite(records[index].kind)
            records.remove(at: index)
            revisionRecords[noteId] = nil
        }
    }

    // MARK: Zaman çizelgesi

    func timeline(
        customerId: String,
        cursor: String?,
        limit: Int?
    ) async throws -> Page<TimelineEntry> {
        await latency(0.4)
        let size = min(limit ?? 50, 200)
        let appointments = booking.appointmentSnapshot(customerId: customerId)

        return try withLock {
            var events: [TimelineEntry] = appointments.map { appointment in
                .appointment(
                    TimelineHeader(id: appointment.id, occurredAt: appointment.startsAt),
                    AppointmentTimelinePayload(
                        status: appointment.status,
                        startsAt: appointment.startsAt,
                        endsAt: appointment.endsAt,
                        branchId: appointment.branchId,
                        totalMinor: appointment.totalMinor
                    )
                )
            }

            events += visible(records)
                .filter { $0.customerId == customerId }
                .map { note in
                    .note(
                        TimelineHeader(id: note.id, occurredAt: note.createdAt),
                        NoteTimelinePayload(
                            kind: note.kind,
                            body: note.body,
                            appointmentId: note.appointmentId,
                            authorUserId: note.authorUserId,
                            customerVisible: note.customerVisible
                        )
                    )
                }

            // Sunucudaki `order by occurred_at desc, id desc` — cursor bu ikili
            // anahtar üzerinde ilerliyor.
            events.sort { ($0.occurredAt, $0.id) > ($1.occurredAt, $1.id) }

            if let cursor {
                guard let key = MockTimelineCursor.decode(cursor) else {
                    throw MockErrors.validation("Geçersiz cursor", path: "cursor")
                }
                events = events.filter { ($0.occurredAt, $0.id) < (key.occurredAt, key.id) }
            }

            let page = Array(events.prefix(size))
            let hasMore = events.count > size
            let next = hasMore ? page.last.map { MockTimelineCursor.encode($0) } : nil
            return Page(data: page, pageInfo: PageInfo(nextCursor: next, hasMore: hasMore))
        }
    }

    // MARK: Yardımcılar

    /// Sunucudaki SQL daraltmasının aynısı: klinik notlar sorgudan HİÇ çıkmaz.
    /// Listeyi çekip sonra elemek sayfa boyutunu bozardı.
    private func visible(_ notes: [CustomerNote]) -> [CustomerNote] {
        canReadMedical ? notes : notes.filter { $0.kind == .general }
    }

    private func assertCanWrite(_ kind: CustomerNoteKind) throws {
        if kind.isClinical, !canReadMedical {
            throw MockErrors.forbidden("customer.medical:write")
        }
    }
}

// MARK: - Cursor

enum MockTimelineCursor {

    static func encode(_ entry: TimelineEntry) -> String {
        let raw = "\(entry.occurredAt.timeIntervalSince1970)|\(entry.id)"
        return Data(raw.utf8).base64EncodedString()
    }

    static func decode(_ cursor: String) -> (occurredAt: Date, id: String)? {
        guard let data = Data(base64Encoded: cursor),
              let raw = String(data: data, encoding: .utf8)
        else { return nil }
        let parts = raw.split(separator: "|", maxSplits: 1)
        guard parts.count == 2, let seconds = TimeInterval(parts[0]) else { return nil }
        return (Date(timeIntervalSince1970: seconds), String(parts[1]))
    }
}

// MARK: - Seed

enum MockNoteSeed {

    static func notes(at now: Date) -> [CustomerNote] {
        [
            note(
                customerId: MockCustomerSeed.ayse,
                kind: .general,
                body: "Randevu saatini sabaha almak istiyor.",
                createdAt: now.addingTimeInterval(-86_400 * 12)
            ),
            note(
                customerId: MockCustomerSeed.ayse,
                kind: .treatment,
                body: "3. seans: sağ kol, 18 J. Ciltte kızarıklık gözlenmedi.",
                createdAt: now.addingTimeInterval(-86_400 * 5)
            ),
            note(
                customerId: MockCustomerSeed.zeynep,
                kind: .internal,
                body: "Fiyat konusunda hassas; kampanya çıkınca haber verilecek.",
                createdAt: now.addingTimeInterval(-86_400 * 3)
            ),
        ]
    }

    private static func note(
        customerId: String,
        kind: CustomerNoteKind,
        body: String,
        createdAt: Date
    ) -> CustomerNote {
        CustomerNote(
            id: MockIDs.uuid(),
            customerId: customerId,
            appointmentId: nil,
            kind: kind,
            body: body,
            customerVisible: false,
            authorUserId: MockIDs.userOwner,
            version: 1,
            createdAt: createdAt,
            updatedAt: createdAt
        )
    }
}
