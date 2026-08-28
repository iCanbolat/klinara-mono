import SwiftUI

/// Randevu detayı ve yaşam döngüsü eylemleri.
///
/// Liste ucu (``CalendarEntry``) detay için yeterli değil: `origin`,
/// `cancellationReason` ve buffer'lar yalnız `GET /appointments/:id`'de var.
/// Bu yüzden ekran açılırken kaydı bir kez daha çeker — ve o çağrı aynı
/// zamanda `version`'ı tazeler, yani `If-Match` bayat başlamaz.
struct AppointmentDetailView: View {

    let session: AppSession
    let entryId: String

    @Environment(\.dismiss) private var dismiss

    @State private var state: LoadState<Appointment> = .loading
    @State private var error: APIError?
    @State private var pendingStatus: AppointmentStatus?
    @State private var isCancelling = false
    @State private var cancelReason = ""
    @State private var isRescheduling = false
    @State private var isEditingNotes = false
    /// Paket bağlama sayfası — bir hizmet kalemi için açılır.
    @State private var bindingLine: AppointmentServiceLine?

    private var store: CalendarStore { session.calendarStore }
    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.appointmentWrite) }
    private var canReopen: Bool { session.can(Permissions.appointmentReopen) }
    private var canBindPackage: Bool { session.can(Permissions.packageWrite) }

    var body: some View {
        NavigationStack {
            KlinaraScreen(state: state, onRetry: load) { appointment in
                if let error, !error.isFieldScoped {
                    ErrorBanner(error: error)
                }

                summaryCard(appointment)
                servicesCard(appointment)
                notesCard(appointment)

                if canWrite {
                    actionsCard(appointment)
                }

                KlinaraCard {
                    KlinaraNavigationRow(
                        label: "Geçmiş",
                        detail: "Oluşturma, erteleme ve durum değişimleri",
                        icon: "clock.arrow.circlepath"
                    ) {
                        AppointmentHistoryView(session: session, appointmentId: appointment.id)
                    }
                }
            }
            .navigationTitle("Randevu")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Kapat") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .task { await load() }
            .sheet(item: $bindingLine) { line in
                if let appointment = state.value {
                    BindPackageSheet(
                        session: session,
                        appointment: appointment,
                        line: line,
                        // Bağlama sonrası kaydı yeniden çekiyoruz: yanıt
                        // yalnız sayaç döndürüyor, randevunun kendisini değil.
                        onBound: { Task { await load() } }
                    )
                }
            }
            .overlay {
                if store.isSaving { AuthLoadingOverlay(message: "Kaydediliyor…") }
            }
            .confirmationDialog(
                pendingStatus.map { "Durum \($0.turkishName) olarak güncellensin mi?" } ?? "",
                isPresented: .init(
                    get: { pendingStatus != nil },
                    set: { if !$0 { pendingStatus = nil } }
                ),
                titleVisibility: .visible
            ) {
                if let status = pendingStatus {
                    Button(status.turkishName) { Task { await apply(status) } }
                    Button("Vazgeç", role: .cancel) { pendingStatus = nil }
                }
            }
            .sheet(isPresented: $isCancelling) { cancelSheet }
            .sheet(isPresented: $isRescheduling) {
                if let appointment = state.value {
                    BookingFlowView(session: session, rescheduling: appointment) { updated in
                        state = .loaded(updated)
                    }
                }
            }
            .sheet(isPresented: $isEditingNotes) {
                if let appointment = state.value {
                    AppointmentNotesEditor(session: session, appointment: appointment) { updated in
                        state = .loaded(updated)
                    }
                }
            }
        }
        .tint(KlinaraColor.sage)
    }

    // MARK: Kartlar

    private func summaryCard(_ appointment: Appointment) -> some View {
        KlinaraCard {
            KlinaraRow(
                label: customerName(appointment.customerId),
                detail: customerPhone(appointment.customerId)
            ) {
                KlinaraBadge(
                    text: appointment.status.turkishName,
                    tone: appointment.status.badgeTone
                )
            }
            KlinaraDivider()
            // Tarih hemen altında; `formatRange` günü de yazdığı için burada
            // yalnız saat gösteriliyor.
            KlinaraRow(
                label: "Saat",
                value: "\(clock.formatTime(appointment.startsAt)) – "
                    + clock.formatTime(appointment.endsAt)
            )
            KlinaraDivider()
            KlinaraRow(label: "Tarih", value: clock.formatDate(appointment.startsAt))
            KlinaraDivider()
            KlinaraRow(label: "Tutar", value: Money.format(minor: appointment.totalMinor))
            if appointment.origin == .online {
                KlinaraDivider()
                KlinaraRow(label: "Kaynak", value: appointment.origin.turkishName)
            }
            if let reason = appointment.cancellationReason {
                KlinaraDivider()
                KlinaraRow(label: "İptal sebebi", value: reason)
            }
        }
    }

    private func servicesCard(_ appointment: Appointment) -> some View {
        KlinaraCard(
            title: "Hizmetler",
            // Buffer'lar müşteriye gösterilen saati kirletmez ama takvimde yer
            // tutar; kullanıcı bunu bir yerde görebilmeli.
            footnote: occupiedFootnote(appointment)
        ) {
            let ordered = appointment.services.sorted { $0.sortOrder < $1.sortOrder }
            ForEach(Array(ordered.enumerated()), id: \.element.id) { index, line in
                if index > 0 { KlinaraDivider() }
                serviceRow(line, in: appointment)
            }
        }
    }

    private func serviceRow(_ line: AppointmentServiceLine, in appointment: Appointment) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            KlinaraRow(
                label: serviceName(line.serviceId),
                value: Money.format(minor: line.priceMinor),
                detail: "\(staffName(line.staffProfileId)) · "
                    + "\(clock.formatTime(line.startsAt))–\(clock.formatTime(line.endsAt)) · "
                    + DurationFormat.format(minutes: line.durationMinutes)
            ) {
                ColorDot(hex: session.staffStore.profile(id: line.staffProfileId)?.calendarColor)
            }

            // Bağlı paket rozeti ve bağlama düğmesi: "bu hizmet paketten mi
            // düşecek?" sorusunun cevabı randevu detayında görünmezse
            // kullanıcı tamamlamaya basana kadar öğrenemez.
            if line.customerPackageItemId != nil {
                KlinaraBadge(text: "Paketten düşecek", tone: .positive, icon: "shippingbox")
                    .padding(.horizontal, KlinaraMetrics.md)
                    .padding(.bottom, KlinaraMetrics.sm)
            } else if canBindPackage, !appointment.status.isTerminal {
                Button {
                    bindingLine = line
                } label: {
                    Label("Pakete bağla", systemImage: "shippingbox")
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.sageDeep)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, KlinaraMetrics.md)
                .padding(.bottom, KlinaraMetrics.sm)
            }
        }
    }

    private func notesCard(_ appointment: Appointment) -> some View {
        KlinaraCard(title: "Not") {
            Button {
                guard canWrite else { return }
                isEditingNotes = true
            } label: {
                KlinaraRow(
                    label: appointment.notes ?? "Not eklenmemiş",
                    detail: canWrite ? "Düzenlemek için dokunun" : nil
                ) {
                    if canWrite {
                        Image(systemName: "square.and.pencil")
                            .foregroundStyle(KlinaraColor.sageDeep)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(!canWrite)
        }
    }

    private func actionsCard(_ appointment: Appointment) -> some View {
        // Yalnız sunucunun kabul edeceği geçişler çizilir; basınca 409 alacağı
        // bir düğmeyi göstermek, kullanıcıya yapamayacağı bir şeyi vaat etmek.
        let transitions = appointment.status
            .allowedTransitions(canReopen: canReopen)
            .filter { $0 != .cancelled }

        return VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
            if !transitions.isEmpty {
                KlinaraCard(title: "Durum") {
                    ForEach(Array(transitions.enumerated()), id: \.element) { index, status in
                        if index > 0 { KlinaraDivider() }
                        Button { pendingStatus = status } label: {
                            KlinaraRow(label: status.turkishName) {
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(KlinaraColor.charcoalMuted)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if appointment.status.canReschedule {
                KlinaraButton(
                    title: "Ertele",
                    kind: .secondary,
                    icon: "calendar.badge.clock"
                ) { isRescheduling = true }
            }

            if !appointment.status.isTerminal {
                KlinaraButton(
                    title: "Randevuyu iptal et",
                    kind: .tertiary,
                    icon: "xmark.circle"
                ) { isCancelling = true }
            }
        }
    }

    private var cancelSheet: some View {
        KlinaraFormScaffold(
            title: "Randevuyu iptal et",
            saveTitle: "İptal et",
            isDirty: true,
            isSaving: store.isSaving,
            error: error,
            onSave: cancel
        ) {
            KlinaraFormSection(
                title: "Sebep",
                footnote: "Sebep kaydedilir ve randevu geçmişinde görünür. "
                    + "Randevu silinmez, iptal olarak işaretlenir ve saati serbest kalır."
            ) {
                KlinaraTextField(
                    label: "İptal sebebi",
                    text: $cancelReason,
                    placeholder: "Örn. müşteri erteledi",
                    autocapitalization: .sentences
                )
                .padding(KlinaraMetrics.md)
            }
        }
    }

    // MARK: Eylemler

    private func load() async {
        state = .loading
        do {
            state = .loaded(try await store.appointment(id: entryId))
        } catch {
            // `practitioner` başkasının randevusunda 404 alır — 403 DEĞİL.
            // Sunucu bunu bilerek yapıyor (kaydın varlığını sızdırmamak için),
            // bu yüzden burada "yetkiniz yok" demek de yanlış olurdu.
            state = .failed(error as? APIError ?? .network)
        }
    }

    private func apply(_ status: AppointmentStatus) async {
        guard let appointment = state.value else { return }
        pendingStatus = nil
        error = nil
        do {
            state = .loaded(try await store.changeStatus(appointment, to: status))
        } catch {
            self.error = error as? APIError ?? .network
        }
    }

    private func cancel() async {
        guard let appointment = state.value else { return }
        error = nil
        do {
            let reason = cancelReason.trimmingCharacters(in: .whitespacesAndNewlines)
            state = .loaded(try await store.cancel(
                appointment,
                reason: reason.isEmpty ? nil : reason
            ))
            isCancelling = false
        } catch {
            self.error = error as? APIError ?? .network
        }
    }

    // MARK: Etiketler

    private func customerName(_ id: String) -> String {
        session.customerStore.customer(id: id)?.fullName ?? "Müşteri"
    }

    private func customerPhone(_ id: String) -> String? {
        session.customerStore.customer(id: id)?.phone.map(PhoneNumberField.pretty)
    }

    private func serviceName(_ id: String) -> String {
        session.catalogStore.catalog.services.first { $0.id == id }?.name ?? "Hizmet"
    }

    private func staffName(_ id: String) -> String {
        session.staffStore.profile(id: id)?.userFullName ?? "Personel"
    }

    private func occupiedFootnote(_ appointment: Appointment) -> String? {
        let occupied = appointment.services.reduce(0) { $0 + $1.occupiedMinutes }
        let visible = appointment.services.reduce(0) { $0 + $1.durationMinutes }
        guard occupied > visible else { return nil }
        return "Takvimde \(DurationFormat.format(minutes: occupied)) yer tutar "
            + "(\(DurationFormat.format(minutes: occupied - visible)) hazırlık ve temizlik payı)."
    }
}

/// Not düzenleme sayfası.
///
/// Ayrı bir ekran olmasının sebebi sunucudaki tuzak: `PATCH` gövdesinde `notes`
/// yoksa sunucu notu **siler**. Alanı boş bırakıp kaydetmenin silme anlamına
/// geldiği, kullanıcıya burada açıkça söyleniyor.
private struct AppointmentNotesEditor: View {

    let session: AppSession
    let appointment: Appointment
    let onSaved: (Appointment) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var error: APIError?

    init(session: AppSession, appointment: Appointment, onSaved: @escaping (Appointment) -> Void) {
        self.session = session
        self.appointment = appointment
        self.onSaved = onSaved
        _text = State(initialValue: appointment.notes ?? "")
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isDirty: Bool { trimmed != (appointment.notes ?? "") }

    var body: some View {
        KlinaraFormScaffold(
            title: "Randevu notu",
            isDirty: isDirty,
            isSaving: session.calendarStore.isSaving,
            error: error,
            onSave: save
        ) {
            KlinaraFormSection(
                title: "Not",
                footnote: trimmed.isEmpty && appointment.notes != nil
                    ? "Alanı boş bırakıp kaydederseniz mevcut not silinir."
                    : "Not yalnız klinik ekibince görülür."
            ) {
                KlinaraTextField(
                    label: "Not",
                    text: $text,
                    placeholder: "Örn. ilk seans, cilt testi yapıldı",
                    error: error?.fieldErrors["notes"],
                    autocapitalization: .sentences
                )
                .padding(KlinaraMetrics.md)
            }
        }
    }

    private func save() async {
        error = nil
        do {
            let updated = try await session.calendarStore.updateNotes(
                appointment,
                notes: trimmed.isEmpty ? nil : trimmed
            )
            onSaved(updated)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
