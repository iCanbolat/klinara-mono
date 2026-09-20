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
    ///
    /// Üçü aynı veriyi üç ayrı soruya cevap verecek biçimde çizer: "sırada ne
    /// var", "bugün nerede boşluk var", "bu hafta nerede boşluk var".
    enum Mode: String, CaseIterable, Identifiable {
        case agenda
        case grid
        case week

        var id: String { rawValue }

        var turkishName: String {
            switch self {
            case .agenda: return "Ajanda"
            case .grid: return "Gün"
            case .week: return "Hafta"
            }
        }

        var icon: String {
            switch self {
            case .agenda: return "list.bullet"
            case .grid: return "square.grid.2x2"
            case .week: return "calendar"
            }
        }

        /// Bir "ileri/geri" adımının kaç gün olduğu.
        var stride: Int { self == .week ? 7 : 1 }
    }

    private let service: any BookingService
    private let catalog: CatalogStore

    private(set) var state: LoadState<CalendarResponse> = .loading
    private(set) var isSaving = false

    /// Elde veri VARKEN süren bir yeniden çekme.
    ///
    /// ``state``i `.loading`e düşürmek yerine bu bayrak kalkıyor: gün
    /// değiştirmek, personel filtrelemek ve aşağı çekmek aynı ekranın *aynı*
    /// düzenini yeniden dolduruyor, farklı bir ekran açmıyor. Yer tutucuya
    /// geri dönmek o düzeni bir anlığına sökmek demekti — ekran zıplıyor,
    /// kaydırma konumu sıfırlanıyor ve iskelet gelen veriden hızlı olduğu
    /// için hepsi yanıp sönme olarak görülüyordu. İskelet yalnız gerçekten
    /// hiçbir şeyin olmadığı ilk yüklemede.
    private(set) var isRefreshing = false

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

    /// `.task(id:)` anahtarı: bunlardan biri değişince veri yeniden çekilir.
    ///
    /// `mode` de anahtarın parçası: gün ve hafta **ayrı uçlardan** geliyor,
    /// mod değişimi yeni bir istek gerektiriyor. Ajanda ile gün aynı veriyi
    /// paylaşıyor ama ayırmamak, `scope`u modun belirlediği yerde iki modun
    /// aynı anahtarla farklı aralık istemesi demekti.
    struct LoadKey: Hashable {
        let branchId: String?
        let scope: String
        let staffProfileId: String?
    }

    func loadKey(clock: BranchClock, branchId: String?) -> LoadKey {
        LoadKey(
            branchId: branchId,
            scope: scope(clock: clock),
            staffProfileId: staffFilter
        )
    }

    /// İstenen aralığın anahtarı — hafta modunda **haftanın ilk günü**, aksi
    /// hâlde görüntülenen gün. Hafta içinde gün değiştirmek yeniden çekmemeli.
    private func scope(clock: BranchClock) -> String {
        switch mode {
        case .week: return "w" + clock.localDateString(clock.startOfWeek(selectedDate))
        case .agenda, .grid: return "d" + clock.localDateString(selectedDate)
        }
    }

    // MARK: Gezinme

    func select(_ date: Date) { selectedDate = date }

    func shift(days: Int, clock: BranchClock) {
        selectedDate = clock.adding(days: days, to: selectedDate)
    }

    /// Modun kendi adımıyla ileri/geri: hafta görünümünde bir gün atlamak,
    /// çoğu zaman aynı haftada kalıp hiçbir şeyi değiştirmezdi.
    func step(_ direction: Int, clock: BranchClock) {
        shift(days: direction * mode.stride, clock: clock)
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
        // İlk yüklemede iskelet; sonrasında eldeki gün ekranda kalır.
        if state.value == nil { state = .loading }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            switch mode {
            case .week:
                state = .loaded(try await service.calendarWeek(CalendarWeekQuery(
                    branchId: branchId,
                    weekStart: clock.localDateString(clock.startOfWeek(selectedDate)),
                    staffProfileId: staffFilter
                )))
            case .agenda, .grid:
                state = .loaded(try await service.calendarDay(CalendarDayQuery(
                    branchId: branchId,
                    date: clock.localDateString(selectedDate),
                    staffProfileId: staffFilter
                )))
            }
        } catch let error as APIError where error.isSilent {
            // İptal hata DEĞİL: `.task(id:)` anahtarı değişince SwiftUI süren
            // isteği iptal ediyor ve hemen yenisini başlatıyor. Bunu ekrana
            // basmak, mesajı boş bir kırmızı bant çizmek ve devam eden doğru
            // isteğin sonucunu da üstüne yazdırmamak demekti.
            return
        } catch {
            // İptal edilmiş bir görevin `state`i, yerine geçen görevin
            // sonucunu ezmemeli.
            guard !Task.isCancelled else { return }
            state = .failed(error as? APIError ?? .network)
        }
    }

    // MARK: Yoğunluk

    /// `density[]` → `yerelGün → saat → randevu sayısı`.
    ///
    /// Sunucu bunu **iptal ve gelmedi hariç** hesaplıyor; ısı haritası
    /// "gerçekten dolu olan saat"i gösteriyor, "bir zamanlar doluydu"yu değil.
    ///
    /// UYARI: sunucu bu kovaları personel filtresine göre daraltmıyor
    /// (`calendar.repository.ts:loadDensity`). Filtre açıkken bloklar
    /// daralıyor ama ısı şube geneli kalıyor; ekran bunu yazıyla söylüyor.
    var densityByDay: [String: [Int: Int]] {
        var result: [String: [Int: Int]] = [:]
        for bucket in state.value?.density ?? [] {
            result[bucket.localDay, default: [:]][bucket.localHour] = bucket.appointmentCount
        }
        return result
    }

    /// Haftanın en yoğun saati. Günler ortak bir ölçekle boyanmazsa iki gün
    /// aynı koyulukta görünüp farklı doluluğu anlatır.
    var densityPeak: Int {
        state.value?.density.map(\.appointmentCount).max() ?? 0
    }

    /// Gün başına toplam randevu — tarih şeridindeki noktalar için.
    var countsByDay: [String: Int] {
        var counts: [String: Int] = [:]
        for bucket in state.value?.density ?? [] {
            counts[bucket.localDay, default: 0] += bucket.appointmentCount
        }
        return counts
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
