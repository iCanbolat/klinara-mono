import SwiftUI

/// Müşteri kartının Faz 3 hâli: kimlik bilgileri ve randevu geçmişi.
///
/// Notlar zaman çizelgesi, fotoğraflar ve tıbbi profil Faz 4'e ait; bu ekran
/// onlara yer açacak biçimde bölümlenmiş durumda.
struct CustomerDetailView: View {

    let session: AppSession
    let customerId: String

    @State private var appointments: LoadState<[CalendarEntry]> = .loading
    @State private var isEditing = false
    @State private var isArchiving = false
    @State private var error: APIError?

    private var store: CustomerStore { session.customerStore }
    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.customerWrite) }
    private var customer: Customer? { store.customer(id: customerId) }

    var body: some View {
        ZStack {
            KlinaraColor.surface.ignoresSafeArea()

            if let customer {
                ScrollView {
                    VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                        if let error, !error.isFieldScoped {
                            ErrorBanner(error: error)
                        }
                        detailsCard(customer)
                        if let notes = customer.notes {
                            KlinaraCard(title: "Not") {
                                KlinaraRow(label: notes)
                            }
                        }
                        appointmentsCard
                        if canWrite { archiveButton }
                    }
                    .padding(.horizontal, KlinaraMetrics.screenInset)
                    .padding(.vertical, KlinaraMetrics.lg)
                }
            } else {
                EmptyStateView(
                    icon: "person.crop.circle.badge.questionmark",
                    title: "Müşteri bulunamadı",
                    message: "Kayıt arşivlenmiş olabilir."
                )
            }
        }
        .navigationTitle(customer?.fullName ?? "Müşteri")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canWrite, customer != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Düzenle") { isEditing = true }
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.sageDeep)
                }
            }
        }
        .task { await loadAppointments() }
        .sheet(isPresented: $isEditing) {
            if let customer {
                CustomerEditorView(session: session, target: .edit(customer))
            }
        }
        .confirmationDialog(
            "Müşteri arşivlensin mi?",
            isPresented: $isArchiving,
            titleVisibility: .visible
        ) {
            Button("Arşivle", role: .destructive) { Task { await archive() } }
            Button("Vazgeç", role: .cancel) {}
        } message: {
            Text(
                "Kayıt silinmez, listeden çıkar. Geçmiş randevular korunur ve "
                    + "telefon numarası yeniden kullanılabilir hâle gelir."
            )
        }
    }

    private func detailsCard(_ customer: Customer) -> some View {
        KlinaraCard(title: "Bilgiler") {
            if let phone = customer.phone {
                KlinaraRow(label: "Telefon", value: PhoneNumberField.pretty(phone))
                KlinaraDivider()
            }
            if let email = customer.email {
                KlinaraRow(label: "E-posta", value: email)
                KlinaraDivider()
            }
            if let birthDate = customer.birthDate {
                KlinaraRow(label: "Doğum tarihi", value: formatted(birthDate))
                KlinaraDivider()
            }
            KlinaraRow(
                label: "Cinsiyet",
                value: customer.gender?.turkishName ?? CustomerGender.undisclosed.turkishName
            )
            KlinaraDivider()
            KlinaraRow(label: "Kayıt", value: clock.formatDate(customer.createdAt))
        }
    }

    @ViewBuilder
    private var appointmentsCard: some View {
        switch appointments {
        case .loading:
            KlinaraCard(title: "Randevular") {
                ProgressView()
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity)
                    .padding(KlinaraMetrics.lg)
            }

        case .failed(let failure):
            ErrorBanner(error: failure, onRetry: { Task { await loadAppointments() } })

        case .loaded(let entries):
            KlinaraCard(
                title: "Randevular",
                footnote: entries.isEmpty ? nil : "Son bir yıl."
            ) {
                if entries.isEmpty {
                    KlinaraRow(label: "Randevu kaydı yok")
                } else {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { KlinaraDivider() }
                        KlinaraRow(
                            label: entry.serviceSummary,
                            detail: clock.formatDateTime(entry.startsAt)
                        ) {
                            KlinaraBadge(
                                text: entry.status.turkishName,
                                tone: entry.status.badgeTone
                            )
                        }
                    }
                }
            }
        }
    }

    private var archiveButton: some View {
        KlinaraButton(
            title: "Müşteriyi arşivle",
            kind: .tertiary,
            icon: "archivebox"
        ) { isArchiving = true }
    }

    private func loadAppointments() async {
        appointments = .loading
        let now = Date()
        do {
            let page = try await session.services.booking.appointments(AppointmentListQuery(
                branchId: session.selectedBranchId,
                from: clock.adding(days: -365, to: now),
                to: clock.adding(days: 365, to: now),
                customerId: customerId
            ))
            appointments = .loaded(page.data.sorted { $0.startsAt > $1.startsAt })
        } catch {
            appointments = .failed(error as? APIError ?? .network)
        }
    }

    private func archive() async {
        error = nil
        do {
            _ = try await store.archive(id: customerId)
        } catch {
            self.error = error as? APIError ?? .network
        }
    }

    private func formatted(_ localDate: String) -> String {
        clock.date(fromLocalDateString: localDate).map(clock.formatDate) ?? localDate
    }
}
