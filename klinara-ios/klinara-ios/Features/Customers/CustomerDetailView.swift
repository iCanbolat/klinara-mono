import SwiftUI

/// Müşteri kartı — Faz 4 hâli.
///
/// Üç bölüm: **Bilgiler** (kimlik, iletişim, adres, etiketler), **zaman
/// çizelgesi** (randevu + not, tek akış) ve **fotoğraflar ve belgeler**.
///
/// Faz 3'te ayrı bir randevu isteği vardı; zaman çizelgesi randevuları zaten
/// getirdiği için kaldırıldı — ikisi birden aynı veriyi iki kez çekerdi.
struct CustomerDetailView: View {

    let session: AppSession
    let customerId: String

    @State private var record: CustomerRecordStore?
    @State private var packages: CustomerPackagesStore?
    @State private var thumbnails: ThumbnailCache?
    @State private var isEditing = false
    @State private var isArchiving = false
    @State private var isMerging = false
    @State private var composingNote = false
    @State private var editingNoteId: NoteReference?
    @State private var error: APIError?

    private var store: CustomerStore { session.customerStore }
    private var clock: BranchClock { session.clock }
    private var canWrite: Bool { session.can(Permissions.customerWrite) }
    private var canMerge: Bool { session.can(Permissions.customerMerge) }
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
                            KlinaraCard(title: "Kart notu") {
                                KlinaraRow(label: notes)
                            }
                        }
                        recordSections
                        actionButtons
                    }
                    .padding(.horizontal, KlinaraMetrics.screenInset)
                    .padding(.vertical, KlinaraMetrics.lg)
                }
            } else {
                EmptyStateView(
                    icon: "person.crop.circle.badge.questionmark",
                    title: "Müşteri bulunamadı",
                    message: "Kayıt arşivlenmiş ya da başka bir karta birleştirilmiş olabilir."
                )
            }
        }
        .navigationTitle(customer?.fullName ?? "Müşteri")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .task(id: customerId) { await setUpRecord() }
        .sheet(isPresented: $isEditing) {
            if let customer {
                CustomerEditorView(session: session, target: .edit(customer))
            }
        }
        .sheet(isPresented: $isMerging) {
            if let customer {
                CustomerMergeView(session: session, target: customer)
            }
        }
        .sheet(isPresented: $composingNote) {
            if let record {
                NoteEditorView(session: session, record: record, existing: nil)
            }
        }
        .sheet(item: $editingNoteId) { noteId in
            if let record, let note = record.note(id: noteId.value) {
                NoteEditorView(session: session, record: record, existing: note)
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

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        if canWrite, customer != nil {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Düzenle") { isEditing = true }
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.sageDeep)
            }
        }
    }

    // MARK: Bilgiler

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
            if let address = customer.addressSummary {
                KlinaraDivider()
                KlinaraRow(label: "Adres", detail: address)
            }
            if let source = customer.source {
                KlinaraDivider()
                KlinaraRow(label: "Geliş kaynağı", value: source.turkishName)
            }
            KlinaraDivider()
            KlinaraRow(label: "Kayıt", value: clock.formatDate(customer.createdAt))

            if !customer.tags.isEmpty {
                KlinaraDivider()
                CustomerTagRow(tags: customer.tags)
            }
        }
    }

    // MARK: Kart verisi

    @ViewBuilder
    private var recordSections: some View {
        if let record, let thumbnails {
            CustomerTimelineView(
                session: session,
                record: record,
                onEditNote: { editingNoteId = NoteReference(value: $0) }
            )

            if canWrite {
                KlinaraButton(title: "Not ekle", kind: .secondary, icon: "square.and.pencil") {
                    composingNote = true
                }
            }

            // Paketler zaman çizelgesinin ALTINDA: kartı açan kişinin ilk
            // sorusu "ne zaman geldi", ikincisi "kaç seansı kaldı".
            if let packages {
                CustomerPackagesSection(session: session, store: packages)
            }

            CustomerFilesSection(session: session, record: record, thumbnails: thumbnails)

            if record.canReadMedical {
                KlinaraCard {
                    KlinaraNavigationRow(
                        label: "Öncesi / sonrası",
                        detail: "Karşılaştırma grupları",
                        icon: "rectangle.on.rectangle"
                    ) {
                        PhotoGroupsView(
                            session: session,
                            record: record,
                            thumbnails: thumbnails
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var actionButtons: some View {
        if canMerge, customer != nil {
            KlinaraButton(
                title: "Mükerrer kaydı birleştir",
                kind: .tertiary,
                icon: "arrow.triangle.merge"
            ) { isMerging = true }
        }
        if canWrite {
            KlinaraButton(title: "Müşteriyi arşivle", kind: .tertiary, icon: "archivebox") {
                isArchiving = true
            }
        }
    }

    // MARK: Eylemler

    /// Kart verisi kartla birlikte doğar. Store'u `.task(id:)` içinde kurmak,
    /// başka bir müşteriye geçildiğinde eski notların ekranda kalmamasını
    /// garanti ediyor.
    private func setUpRecord() async {
        let store = CustomerRecordStore(
            customerId: customerId,
            notes: session.services.notes,
            files: session.services.files,
            canReadMedical: session.can(Permissions.customerMedicalRead),
            canWriteMedical: session.can(Permissions.customerMedicalWrite)
        )
        record = store
        thumbnails = ThumbnailCache(service: session.services.files)

        // Paket izni yoksa store hiç kurulmaz: boş bir "Paketler" kartı
        // göstermek, hakkı olmayan bir müşteri izlenimi verirdi.
        let packageStore = session.can(Permissions.packageRead)
            ? CustomerPackagesStore(customerId: customerId, service: session.services.packages)
            : nil
        packages = packageStore

        // Hepsi paralel: kart açılışı isteklerin toplamı kadar beklemesin.
        async let timeline: Void = store.loadTimeline()
        async let notes: Void = store.loadNotes()
        async let files: Void = store.loadFiles()
        async let packageList: Void = packageStore?.load() ?? ()
        _ = await (timeline, notes, files, packageList)
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

/// `sheet(item:)` bir `Identifiable` istiyor; çıplak `String?` yetmiyor.
private struct NoteReference: Identifiable {
    let value: String
    var id: String { value }
}
