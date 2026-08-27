import SwiftUI

/// Takvim ekranının veri ve yazma kapısı.
///
/// Katalog ve personelden farklı olarak takvim verisi **şube ve tarih
/// kapsamlıdır**: aynı store farklı bir güne bakınca içeriği tamamen değişir.
/// Buna rağmen oturum ömürlü tutulmasının sebebi yazma tarafı: randevu
/// oluşturma sayfası, detay ekranı ve müşteri kartı aynı listeyi güncellemek
/// zorunda ve her biri kendi kopyasını tutsaydı biri diğerinden habersiz kalırdı.
///
/// Yazma metotları ``CatalogStore``'un kuralını izler: sunucudan dönen kaydı
/// yerel kopyaya işle, **hatayı çağırana fırlat**. Liste durumu bozulmaz;
/// hatayı gösterme işi formun.
@MainActor
@Observable
final class CalendarStore {

    /// Takvimin hangi biçimde çizildiği.
    enum Mode: String, CaseIterable, Identifiable {
        case agenda
        case grid

        var id: String { rawValue }
        var turkishName: String { self == .agenda ? "Ajanda" : "Izgara" }
        var icon: String { self == .agenda ? "list.bullet" : "square.grid.2x2" }
    }

    private let service: any BookingService
    private let catalog: CatalogStore

    private(set) var state: LoadState<CalendarResponse> = .loading
    private(set) var isSaving = false

    /// Görüntülenen gün — şube saat diliminde bir "an", gün başlangıcı.
    private(set) var selectedDate: Date
    var mode: Mode = .agenda

    /// Yalnız bu personelin randevuları. `nil` = şube geneli.
    private(set) var staffFilter: String?

    init(service: any BookingService, catalog: CatalogStore, today: Date = Date()) {
        self.service = service
        self.catalog = catalog
        self.selectedDate = today
    }

    /// `.task(id:)` anahtarı: bu üçlüden biri değişince veri yeniden çekilir.
    struct LoadKey: Hashable {
        let branchId: String?
        let day: String
        let staffProfileId: String?
    }

    func loadKey(clock: BranchClock, branchId: String?) -> LoadKey {
        LoadKey(
            branchId: branchId,
            day: clock.localDateString(selectedDate),
            staffProfileId: staffFilter
        )
    }

    // MARK: Gezinme

    func select(_ date: Date) { selectedDate = date }

    func shift(days: Int, clock: BranchClock) {
        selectedDate = clock.adding(days: days, to: selectedDate)
    }

    func goToToday() { selectedDate = Date() }

    func filter(staffProfileId: String?) { staffFilter = staffProfileId }

    // MARK: Okuma

    var response: CalendarResponse? { state.value }

    var entries: [CalendarEntry] { state.value?.appointments ?? [] }

    /// Sonlanmış randevular listede kalır ama ayrı bir grupta: iptal edilen bir
    /// randevunun kaybolması "ben bunu iptal etmiş miydim?" sorusunu doğurur.
    var activeEntries: [CalendarEntry] {
        entries.filter { !$0.status.isTerminal }.sorted { $0.startsAt < $1.startsAt }
    }

    var terminalEntries: [CalendarEntry] {
        entries.filter(\.status.isTerminal).sorted { $0.startsAt < $1.startsAt }
    }

    func load(branchId: String?, clock: BranchClock) async {
        guard let branchId else {
            state = .failed(.problem(ProblemDetails(
                code: .validationFailed,
                title: "Şube seçilmedi",
                detail: "Takvimi görmek için önce bir şube seçin.",
                status: 400
            )))
            return
        }
        state = .loading
        do {
            state = .loaded(try await service.calendarDay(CalendarDayQuery(
                branchId: branchId,
                date: clock.localDateString(selectedDate),
                staffProfileId: staffFilter
            )))
        } catch {
            state = .failed(error as? APIError ?? .network)
        }
    }

    func history(id: String) async throws -> [AppointmentHistoryEntry] {
        try await service.history(id: id)
    }

    func appointment(id: String) async throws -> Appointment {
        try await service.appointment(id: id)
    }

    func availability(_ query: AvailabilityQuery) async throws -> AvailabilityResponse {
        try await service.availability(query)
    }

    // MARK: Yazma

    func create(_ input: CreateAppointmentInput) async throws -> Appointment {
        try await mutating {
            // Anahtar çağrı başına üretilir: kullanıcı hatayı düzeltip yeniden
            // gönderdiğinde bu YENİ bir istektir. Aynı anahtarı yeniden
            // kullanmak, düzeltilmiş gövdeyi `IDEMPOTENCY_CONFLICT`e sokardı.
            let created = try await service.create(input, idempotencyKey: UUID().uuidString)
            merge(created)
            return created
        }
    }

    func reschedule(
        _ appointment: Appointment,
        _ input: RescheduleAppointmentInput
    ) async throws -> Appointment {
        try await mutating {
            let updated = try await service.reschedule(
                id: appointment.id,
                version: appointment.version,
                input
            )
            merge(updated)
            return updated
        }
    }

    func cancel(_ appointment: Appointment, reason: String?) async throws -> Appointment {
        try await mutating {
            let updated = try await service.cancel(id: appointment.id, reason: reason)
            merge(updated)
            return updated
        }
    }

    func changeStatus(
        _ appointment: Appointment,
        to status: AppointmentStatus,
        reason: String? = nil
    ) async throws -> Appointment {
        try await mutating {
            let updated = try await service.changeStatus(
                id: appointment.id,
                ChangeAppointmentStatusInput(status: status, reason: reason)
            )
            merge(updated)
            return updated
        }
    }

    func updateNotes(_ appointment: Appointment, notes: String?) async throws -> Appointment {
        try await mutating {
            let updated = try await service.updateNotes(
                id: appointment.id,
                version: appointment.version,
                notes: notes
            )
            merge(updated)
            return updated
        }
    }

    // MARK: Yardımcılar

    /// Yazma sonucunu listeye işler. Yeniden çekmiyoruz: sunucu güncel kaydı
    /// zaten döndürdü ve ekranın bir tur daha beklemesi için sebep yok.
    ///
    /// Randevu görüntülenen günün dışına taşındıysa (erteleme) listeden düşer —
    /// ekranda kalması, kullanıcının bakmadığı bir günü bu güne çizmek olurdu.
    private func merge(_ appointment: Appointment) {
        guard let current = state.value else { return }
        let entry = appointment.calendarEntry(
            services: catalog.catalog.services,
            customers: customerCache
        )
        var list = current.appointments.filter { $0.id != appointment.id }
        let inRange = appointment.startsAt < current.to && appointment.endsAt > current.from
        let matchesFilter = staffFilter.map(entry.staffProfileIds.contains) ?? true
        if inRange, matchesFilter { list.append(entry) }

        state = .loaded(CalendarResponse(
            branchId: current.branchId,
            timezone: current.timezone,
            from: current.from,
            to: current.to,
            appointments: list.sorted { $0.startsAt < $1.startsAt },
            density: current.density
        ))
    }

    /// Müşteri adı liste satırında gerekiyor ama detay yanıtı onu taşımıyor.
    /// Yazma sonrası satırı kurabilmek için son bilinen müşterileri saklıyoruz;
    /// bilinmeyen bir kimlikte satır adsız kalmasın diye ``CustomerStore``
    /// buraya besleme yapar.
    private var customerCache: [Customer] = []

    func cacheCustomers(_ customers: [Customer]) {
        customerCache = customers
    }

    private func mutating<T>(_ work: () async throws -> T) async throws -> T {
        isSaving = true
        defer { isSaving = false }
        return try await work()
    }
}
