import SwiftUI

/// İzin / istisna oluşturma.
///
/// **Saat dilimi burada kritiktir.** Kullanıcı "Salı 09:00'dan Perşembe
/// 18:00'e izinli" der ve bunu kliniğin saatinde düşünür. Cihazın saat
/// dilimini kullanmak, seyahatteki bir yöneticinin izni yanlış saate
/// yazması demektir — tarih seçici de gönderilen değer de ``BranchClock``
/// üzerinden şube saatinde kurulur.
struct ScheduleExceptionEditorView: View {

    let session: AppSession
    var presetStaffProfileId: String?
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var staffProfileId: String?
    @State private var startsAt: Date
    @State private var endsAt: Date
    @State private var reason = ""
    @State private var recurrence: ScheduleRecurrence = .none
    @State private var intervalWeeks = 1
    @State private var weekdays: Set<Int> = []
    @State private var recurrenceUntil: Date
    @State private var error: APIError?
    @State private var isSaving = false

    private var clock: BranchClock { session.clock }

    init(session: AppSession, presetStaffProfileId: String?, onSaved: @escaping () -> Void) {
        self.session = session
        self.presetStaffProfileId = presetStaffProfileId
        self.onSaved = onSaved

        let clock = session.clock
        let today = clock.startOfDay(Date())
        let start = clock.date(on: clock.adding(days: 1, to: today), at: .nineAM)
        _staffProfileId = State(initialValue: presetStaffProfileId)
        _startsAt = State(initialValue: start)
        _endsAt = State(initialValue: clock.date(on: clock.adding(days: 1, to: today), at: .sixPM))
        _recurrenceUntil = State(initialValue: clock.adding(days: 30, to: start))
    }

    var body: some View {
        KlinaraFormScaffold(
            title: "Yeni istisna",
            saveTitle: "Oluştur",
            canSave: isValid,
            isDirty: true,
            isSaving: isSaving,
            error: error,
            onSave: save
        ) {
            staffSection
            rangeSection
            recurrenceSection
        }
        .task { await session.staffStore.load() }
    }

    // MARK: Bölümler

    @ViewBuilder
    private var staffSection: some View {
        if presetStaffProfileId == nil {
            KlinaraFormSection(title: "Personel") {
                let profiles = session.staffStore.profiles.filter(\.isActive)
                if profiles.isEmpty {
                    KlinaraRow(label: "Aktif personel yok")
                } else {
                    ForEach(Array(profiles.enumerated()), id: \.element.id) { index, profile in
                        if index > 0 { KlinaraDivider() }
                        Button {
                            staffProfileId = profile.id
                        } label: {
                            KlinaraRow(label: profile.userFullName, detail: profile.title) {
                                if staffProfileId == profile.id {
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
        }
    }

    private var rangeSection: some View {
        KlinaraFormSection(
            title: "Aralık",
            footnote: "Saatler \(clock.timeZone.identifier) diliminde. Bitiş, başlangıçtan sonra olmalı."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                DatePicker("Başlangıç", selection: $startsAt)
                    .environment(\.timeZone, clock.timeZone)
                    .klinaraText(.bodyM)
                    .onChange(of: startsAt) { _, newValue in
                        // Bitişi başlangıcın gerisinde bırakmak, sunucudan
                        // dönecek bir doğrulama hatasını beklemek yerine
                        // burada engelleniyor.
                        if endsAt <= newValue {
                            endsAt = newValue.addingTimeInterval(60 * 60)
                        }
                        if recurrenceUntil <= endsAt {
                            recurrenceUntil = clock.adding(days: 30, to: endsAt)
                        }
                    }

                DatePicker("Bitiş", selection: $endsAt, in: startsAt...)
                    .environment(\.timeZone, clock.timeZone)
                    .klinaraText(.bodyM)

                KlinaraTextField(
                    label: "Sebep",
                    text: $reason,
                    placeholder: "Yıllık izin, resmî tatil…",
                    error: error?.fieldErrors["reason"],
                    autocapitalization: .sentences
                )
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private var recurrenceSection: some View {
        KlinaraFormSection(title: "Tekrar") {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                Picker("Tekrar", selection: $recurrence) {
                    ForEach(ScheduleRecurrence.allCases) { option in
                        Text(option.turkishName).tag(option)
                    }
                }
                .pickerStyle(.segmented)
            }
            .padding(KlinaraMetrics.md)

            if recurrence == .weekly {
                KlinaraDivider()
                VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                    Text("Günler")
                        .klinaraText(.label)
                        .foregroundStyle(KlinaraColor.charcoalMuted)

                    HStack(spacing: KlinaraMetrics.xs) {
                        ForEach(Weekday.displayOrder) { weekday in
                            weekdayToggle(weekday)
                        }
                    }
                }
                .padding(KlinaraMetrics.md)

                KlinaraDivider()
                KlinaraStepperRow(
                    label: "Sıklık",
                    value: $intervalWeeks,
                    range: 1...52,
                    step: 1,
                    format: { $0 == 1 ? "Her hafta" : "\($0) haftada bir" }
                )

                KlinaraDivider()
                // Bitiş tarihi weekly tekrarda ZORUNLUDUR — sunucu
                // `recurrenceUntil` olmadan `400` döner. Opsiyonel gösterip
                // kullanıcıyı kaçınılmaz bir hataya sürüklemiyoruz.
                DatePicker(
                    "Şu tarihe kadar",
                    selection: $recurrenceUntil,
                    in: endsAt...,
                    displayedComponents: .date
                )
                .environment(\.timeZone, clock.timeZone)
                .klinaraText(.bodyM)
                .padding(KlinaraMetrics.md)
            }
        }
    }

    private func weekdayToggle(_ weekday: Weekday) -> some View {
        let isSelected = weekdays.contains(weekday.rawValue)
        return Button {
            if isSelected {
                weekdays.remove(weekday.rawValue)
            } else {
                weekdays.insert(weekday.rawValue)
            }
        } label: {
            Text(weekday.shortName)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(isSelected ? KlinaraColor.surfaceRaised : KlinaraColor.charcoal)
                .frame(width: 38, height: 34)
                .background(isSelected ? KlinaraColor.sage : KlinaraColor.surfaceRaised)
                .overlay(
                    RoundedRectangle(cornerRadius: KlinaraMetrics.sm)
                        .stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth)
                )
                .clipShape(.rect(cornerRadius: KlinaraMetrics.sm))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(weekday.turkishName)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    // MARK: Kaydetme

    private var isValid: Bool {
        guard staffProfileId != nil, session.selectedBranchId != nil, endsAt > startsAt else {
            return false
        }
        // Haftalık tekrarda en az bir gün ve bir bitiş tarihi zorunlu.
        return recurrence != .weekly || (!weekdays.isEmpty && recurrenceUntil > endsAt)
    }

    private func save() async {
        guard let staffProfileId, let branchId = session.selectedBranchId else { return }
        error = nil
        isSaving = true
        defer { isSaving = false }

        do {
            _ = try await session.services.scheduling.createScheduleException(
                ScheduleExceptionInput(
                    staffProfileId: staffProfileId,
                    branchId: branchId,
                    startsAt: clock.wireValue(startsAt),
                    endsAt: clock.wireValue(endsAt),
                    reason: reason.isEmpty ? nil : reason,
                    recurrenceType: recurrence,
                    recurrenceIntervalWeeks: recurrence == .weekly ? intervalWeeks : nil,
                    // Tek seferlik kayıtta bu alanlar GÖNDERİLEMEZ (sunucu
                    // açıkça reddediyor); weekly'de ikisi de zorunludur.
                    recurrenceUntil: recurrence == .weekly ? clock.wireValue(recurrenceUntil) : nil,
                    recurrenceWeekdays: recurrence == .weekly ? weekdays.sorted() : nil,
                    isActive: true
                )
            )
            onSaved()
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
