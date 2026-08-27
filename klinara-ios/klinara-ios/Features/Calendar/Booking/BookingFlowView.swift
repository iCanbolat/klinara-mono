import SwiftUI

/// Randevu oluşturma ve erteleme sayfası.
///
/// Tek sayfa, adım adım sihirbaz değil: kullanıcı hizmeti seçtikten sonra
/// müşteriyi değiştirmek isteyebilir ve sihirbaz onu baştan başlatırdı. Sıra
/// yalnız görsel — her bölüm önceki seçimler tamamlandıkça açılır.
///
/// Uygunluk **store'lanmaz**: sorgu bu sayfaya özgü ve kısa ömürlü.
struct BookingFlowView: View {

    let session: AppSession
    /// Ertelenen randevu. `nil` ise yeni kayıt.
    var rescheduling: Appointment?
    /// Izgaradan bir saate dokunularak açıldıysa o gün seçili gelir.
    var startingAt: Date?
    /// Kaydedilen randevu. Erteleme sayfası detay ekranından açılıyor ve o
    /// ekranın kendi kopyası var; haber verilmezse eski saati **ve eski
    /// `version`'ı** göstermeye devam eder — bir sonraki `If-Match` de 409 alır.
    var onSaved: ((Appointment) -> Void)?

    @Environment(\.dismiss) private var dismiss

    @State private var draft: BookingDraft
    @State private var day: Date
    @State private var slots: LoadState<AvailabilityResponse> = .loading
    @State private var error: APIError?
    @State private var conflict: APIError?
    @State private var isCreatingCustomer = false

    private var store: CalendarStore { session.calendarStore }
    private var clock: BranchClock { session.clock }
    private var services: [ClinicService] {
        session.catalogStore.catalog.services.filter(\.isActive)
    }

    init(
        session: AppSession,
        rescheduling: Appointment? = nil,
        startingAt: Date? = nil,
        onSaved: ((Appointment) -> Void)? = nil
    ) {
        self.session = session
        self.rescheduling = rescheduling
        self.startingAt = startingAt
        self.onSaved = onSaved
        let branchId = rescheduling?.branchId ?? session.selectedBranchId ?? ""
        _draft = State(initialValue: BookingDraft(branchId: branchId, rescheduling: rescheduling))
        let clock = session.clock
        _day = State(initialValue: clock.startOfDay(
            startingAt ?? rescheduling?.startsAt ?? session.calendarStore.selectedDate
        ))
    }

    var body: some View {
        KlinaraFormScaffold(
            title: draft.isRescheduling ? "Randevuyu ertele" : "Yeni randevu",
            saveTitle: draft.isRescheduling ? "Ertele" : "Oluştur",
            canSave: draft.isValid,
            isDirty: draft.isDirty,
            isSaving: store.isSaving,
            error: error,
            onSave: save
        ) {
            if draft.branchId.isEmpty {
                KlinaraCard {
                    KlinaraRow(
                        label: "Şube seçilmedi",
                        detail: "Randevu oluşturmak için önce bir şube seçin."
                    )
                }
            } else {
                customerSection
                servicesSection
                if draft.canQueryAvailability {
                    staffSection
                    slotSection
                    summarySection
                }
                notesSection
            }
        }
        .task { await session.customerStore.load() }
        .task(id: availabilityKey) { await loadSlots() }
        .sheet(isPresented: $isCreatingCustomer) {
            CustomerEditorView(session: session, target: .create) { created in
                draft.customerId = created.id
            }
        }
        .sheet(item: $conflict) { problem in
            SlotConflictSheet(
                clock: clock,
                error: problem,
                staffName: staffName
            ) { suggestion in
                // Öneriyi seçmek slotu doldurur ama KAYDETMEZ: kullanıcının
                // yeni saati onaylaması gerek, sessizce başka bir saate
                // randevu yazmak kabul edilemez.
                draft.select(slot: AvailabilitySlot(
                    startsAt: suggestion.startsAt,
                    endsAt: suggestion.endsAt,
                    staffProfileIds: suggestion.staffProfileIds
                ))
                day = clock.startOfDay(suggestion.startsAt)
            }
        }
    }

    // MARK: Bölümler

    @ViewBuilder
    private var customerSection: some View {
        if draft.canEditLineup {
            KlinaraSearchablePicker(
                title: "Müşteri",
                options: session.customerStore.customers,
                label: \.fullName,
                detail: { $0.phone.map(PhoneNumberField.pretty) },
                isSelected: { $0.id == draft.customerId },
                onSelect: { draft.customerId = $0.id },
                searchPrompt: "Müşteri ara",
                emptyMessage: "Eşleşen müşteri yok.",
                createLabel: session.can(Permissions.customerWrite) ? "Yeni müşteri ekle" : nil,
                onCreate: session.can(Permissions.customerWrite) ? { isCreatingCustomer = true } : nil
            )
        } else {
            KlinaraFormSection(title: "Müşteri") {
                KlinaraRow(
                    label: draft.customerId.flatMap {
                        session.customerStore.customer(id: $0)?.fullName
                    } ?? "Müşteri",
                    detail: "Erteleme müşteriyi değiştirmez."
                )
            }
        }
    }

    @ViewBuilder
    private var servicesSection: some View {
        KlinaraFormSection(
            title: "Hizmetler",
            footnote: draft.canEditLineup
                // Düz metin: `KlinaraCard` dipnotu `Text(String)` ile çiziyor
                // ve Markdown yorumlamıyor — yıldızlar ekranda görünür.
                ? "Birden çok hizmet seçilirse seçim sırasıyla ardışık uygulanır; "
                    + "sıra numarası satırın sağında görünür."
                : "Erteleme hizmet dizilimini değiştirmez."
        ) {
            ForEach(Array(services.enumerated()), id: \.element.id) { index, service in
                if index > 0 { KlinaraDivider() }
                Button {
                    guard draft.canEditLineup else { return }
                    draft.toggle(serviceId: service.id)
                } label: {
                    KlinaraRow(
                        label: service.name,
                        value: Money.format(minor: service.effective(in: draft.branchId).priceMinor),
                        detail: DurationFormat.format(
                            minutes: service.effective(in: draft.branchId).durationMinutes
                        )
                    ) {
                        if let order = draft.serviceIds.firstIndex(of: service.id) {
                            KlinaraBadge(text: "\(order + 1)", tone: .positive)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(!draft.canEditLineup)
            }
        }
    }

    @ViewBuilder
    private var staffSection: some View {
        let eligible = draft.eligibleStaff(session.staffStore.profiles)
        KlinaraFormSection(
            title: "Personel",
            footnote: eligible.isEmpty
                ? "Seçilen hizmetlerin hepsini verebilen personel yok. Hizmet seçimini daraltın."
                : "Boş bırakılırsa uygun slotlardaki adaylardan biri atanır."
        ) {
            ForEach(Array(eligible.enumerated()), id: \.element.id) { index, profile in
                if index > 0 { KlinaraDivider() }
                Button {
                    draft.select(staffProfileId: draft.staffProfileId == profile.id ? nil : profile.id)
                } label: {
                    KlinaraRow(label: profile.userFullName, detail: profile.title) {
                        if draft.staffProfileId == profile.id {
                            Image(systemName: "checkmark")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(KlinaraColor.sageDeep)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var slotSection: some View {
        KlinaraFormSection(
            title: "Saat",
            footnote: "Saatler \(clock.timeZone.identifier) diliminde. "
                + "Kapalı saatler, molalar ve dolu slotlar listede çıkmaz."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                dayNavigator

                switch slots {
                case .loading:
                    ProgressView()
                        .tint(KlinaraColor.sage)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, KlinaraMetrics.lg)

                case .failed(let failure):
                    ErrorBanner(error: failure, onRetry: { Task { await loadSlots() } })

                case .loaded(let response):
                    let visible = response.slots.filter { $0.supports(staffProfileId: draft.staffProfileId) }
                    if visible.isEmpty {
                        Text("Bu günde uygun saat yok. Başka bir gün veya personel deneyin.")
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        KlinaraChipGrid(
                            options: visible,
                            title: { clock.formatTime($0.startsAt) },
                            isSelected: { $0.startsAt == draft.slot?.startsAt },
                            badge: { slot in
                                slot.staffProfileIds.count > 1
                                    ? "\(slot.staffProfileIds.count) kişi"
                                    : nil
                            },
                            onTap: { draft.select(slot: $0) }
                        )
                    }
                }
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private var dayNavigator: some View {
        HStack {
            Button {
                day = clock.adding(days: -1, to: day)
            } label: {
                Image(systemName: "chevron.left")
            }
            .frame(width: 44, height: 44)

            Text(clock.formatDate(day))
                .klinaraText(.bodyEmphasis)
                .frame(maxWidth: .infinity)

            Button {
                day = clock.adding(days: 1, to: day)
            } label: {
                Image(systemName: "chevron.right")
            }
            .frame(width: 44, height: 44)
        }
        .foregroundStyle(KlinaraColor.sageDeep)
    }

    @ViewBuilder
    private var summarySection: some View {
        let occupied = draft.occupiedMinutes(services: services)
        let visible = draft.visibleMinutes(services: services)
        if !draft.serviceIds.isEmpty {
            KlinaraFormSection(
                title: "Özet",
                footnote: occupied > visible
                    ? "Takvimde \(DurationFormat.format(minutes: occupied)) yer tutar; "
                        + "müşteriye gösterilen süre \(DurationFormat.format(minutes: visible))."
                    : nil
            ) {
                KlinaraRow(label: "Süre", value: DurationFormat.format(minutes: visible))
                KlinaraDivider()
                KlinaraRow(label: "Tutar", value: Money.format(minor: draft.totalMinor(services: services)))
                if let slot = draft.slot {
                    KlinaraDivider()
                    KlinaraRow(
                        label: "Seçilen saat",
                        value: clock.formatRange(from: slot.startsAt, to: slot.endsAt)
                    )
                }
            }
        }
    }

    private var notesSection: some View {
        KlinaraFormSection(title: draft.isRescheduling ? "Erteleme sebebi" : "Not") {
            KlinaraTextField(
                label: draft.isRescheduling ? "Sebep" : "Not",
                text: draft.isRescheduling ? $draft.reason : $draft.notes,
                placeholder: draft.isRescheduling
                    ? "Örn. müşteri talebi"
                    : "Örn. ilk seans, cilt testi yapılacak",
                error: error?.fieldErrors[draft.isRescheduling ? "reason" : "notes"],
                autocapitalization: .sentences
            )
            .padding(KlinaraMetrics.md)
        }
    }

    // MARK: Veri

    private struct AvailabilityKey: Hashable {
        let day: String
        let serviceIds: [String]
        let staffProfileId: String?
    }

    private var availabilityKey: AvailabilityKey {
        AvailabilityKey(
            day: clock.localDateString(day),
            serviceIds: draft.serviceIds,
            staffProfileId: draft.staffProfileId
        )
    }

    private func loadSlots() async {
        guard draft.canQueryAvailability, !draft.branchId.isEmpty else {
            slots = .loaded(AvailabilityResponse(
                branchId: draft.branchId,
                timezone: clock.timeZone.identifier,
                slotGranularityMinutes: 15,
                slots: []
            ))
            return
        }
        slots = .loading
        do {
            slots = .loaded(try await store.availability(AvailabilityQuery(
                branchId: draft.branchId,
                serviceIds: draft.serviceIds,
                from: clock.startOfDay(day),
                to: clock.adding(days: 1, to: clock.startOfDay(day)),
                staffProfileId: draft.staffProfileId
            )))
        } catch {
            slots = .failed(error as? APIError ?? .network)
        }
    }

    private func save() async {
        error = nil
        do {
            let saved: Appointment
            if let appointment = draft.rescheduling {
                guard let input = draft.rescheduleInput(clock: clock) else { return }
                saved = try await store.reschedule(appointment, input)
            } else {
                guard let input = draft.createInput(clock: clock) else { return }
                saved = try await store.create(input)
            }
            onSaved?(saved)
            dismiss()
        } catch {
            let failure = error as? APIError ?? .network
            // Çakışma kendi sayfasını hak ediyor: gövdede hangi kaynağın dolu
            // olduğu ve üç alternatif var, tek satırlık bir banda sığmaz.
            if case .problem(let problem) = failure, problem.code == .slotConflict {
                conflict = failure
                // Seçilen slot artık geçersiz; listeyi tazeleyip seçimi düşürüyoruz.
                draft.slot = nil
                await loadSlots()
            } else {
                self.error = failure
            }
        }
    }

    private func staffName(_ id: String) -> String {
        session.staffStore.profile(id: id)?.userFullName ?? "Personel"
    }
}

/// `sheet(item:)` için — `APIError` kendisi `Identifiable` değil.
extension APIError: @retroactive Identifiable {
    public var id: String {
        switch self {
        case .problem(let problem): return "\(problem.code.rawValue)#\(problem.requestId ?? "")"
        case .network: return "network"
        case .cancelled: return "cancelled"
        case .malformedResponse(let detail): return "malformed#\(detail)"
        case .uploadFailed(let status): return "upload#\(status)"
        }
    }
}
