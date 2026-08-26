import SwiftUI

/// Personel × hizmet yetkinlik matrisi.
///
/// **Neden tek "Kaydet":** sunucu ucu `PUT /staff/:id/services` listenin
/// TAMAMINI değiştirir. Satır başına otomatik kayıt yapılsaydı, yarım kalan
/// bir istek (uygulama arka plana atıldı, ağ düştü) personelin diğer tüm
/// yetkinliklerini silerdi. Taslak yerelde tutulur, tek seferde gönderilir.
struct StaffServiceMatrixView: View {

    let session: AppSession
    let staffProfileId: String

    @State private var draft: [String: SkillDraft] = [:]
    @State private var originalDraft: [String: SkillDraft] = [:]
    @State private var error: APIError?
    @State private var saved = false
    @State private var didLoad = false

    private var staffStore: StaffStore { session.staffStore }
    private var catalogStore: CatalogStore { session.catalogStore }
    private var canWrite: Bool { session.can(Permissions.staffWrite) }
    private var isDirty: Bool { draft != originalDraft }

    /// Bir hizmetin bu personeldeki yetkinlik taslağı.
    struct SkillDraft: Equatable {
        var isEnabled: Bool
        /// `nil` = hizmetin kendi süresi geçerli.
        var customDurationMinutes: Int?
        var customPriceMinor: Int?
        /// `nil` = kiracı geneli; dolu = yalnız o şubede geçerli.
        var branchId: String?
    }

    var body: some View {
        ZStack {
            KlinaraColor.surface.ignoresSafeArea()
            content
        }
        .navigationTitle("Yetkinlikler")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canWrite, isDirty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Kaydet") { Task { await save() } }
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.sageDeep)
                        .disabled(staffStore.isSaving)
                }
            }
        }
        .task {
            await catalogStore.load()
            await staffStore.load()
            loadDraftIfNeeded()
        }
        .overlay {
            if staffStore.isSaving { AuthLoadingOverlay(message: "Kaydediliyor…") }
        }
    }

    @ViewBuilder
    private var content: some View {
        let activeServices = catalogStore.catalog.services.filter(\.isActive)

        if activeServices.isEmpty {
            EmptyStateView(
                icon: "list.bullet.rectangle",
                title: "Aktif hizmet yok",
                message: "Yetkinlik atayabilmek için önce katalogda hizmet tanımlayın."
            )
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped { ErrorBanner(error: error) }
                    if saved {
                        Text("Yetkinlikler kaydedildi.")
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.sageDeep)
                    }

                    Text("İşaretli hizmetleri bu personel yapabilir. Yetkin olmadığı bir hizmetten randevu açılamaz.")
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .fixedSize(horizontal: false, vertical: true)

                    ForEach(catalogStore.catalog.grouped(activeServices), id: \.category?.id) { group in
                        KlinaraCard(title: group.category?.name ?? "Kategorisiz") {
                            ForEach(Array(group.services.enumerated()), id: \.element.id) { index, item in
                                if index > 0 { KlinaraDivider() }
                                serviceRow(item)
                            }
                        }
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
        }
    }

    private func serviceRow(_ item: ClinicService) -> some View {
        let binding = Binding<SkillDraft>(
            get: { draft[item.id] ?? SkillDraft(isEnabled: false) },
            set: { draft[item.id] = $0 }
        )
        let isEnabled = binding.wrappedValue.isEnabled

        return VStack(alignment: .leading, spacing: 0) {
            KlinaraToggleRow(
                label: item.name,
                detail: "\(DurationFormat.format(minutes: item.durationMinutes)) · \(Money.format(minor: item.priceMinor))",
                isOn: binding.isEnabled,
                isEnabled: canWrite
            )

            if isEnabled {
                VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
                    if session.branches.count > 1 {
                        Picker("Kapsam", selection: binding.branchId) {
                            Text("Tüm şubeler").tag(String?.none)
                            ForEach(session.branches) { branch in
                                Text(branch.name).tag(Optional(branch.id))
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(KlinaraColor.sageDeep)
                        .klinaraText(.bodyM)
                    }

                    KlinaraToggleRow(
                        label: "Bu personel için özel süre",
                        detail: binding.wrappedValue.customDurationMinutes == nil
                            ? "Hizmetin kendi süresi kullanılıyor"
                            : nil,
                        isOn: Binding(
                            get: { binding.wrappedValue.customDurationMinutes != nil },
                            set: { binding.customDurationMinutes.wrappedValue = $0 ? item.durationMinutes : nil }
                        ),
                        isEnabled: canWrite
                    )

                    if binding.wrappedValue.customDurationMinutes != nil {
                        KlinaraStepperRow(
                            label: "Süre",
                            value: Binding(
                                get: { binding.wrappedValue.customDurationMinutes ?? item.durationMinutes },
                                set: { binding.customDurationMinutes.wrappedValue = $0 }
                            ),
                            range: 5...1440,
                            isEnabled: canWrite,
                            format: DurationFormat.format(minutes:)
                        )
                    }
                }
                .padding(.leading, KlinaraMetrics.md)
                .padding(.bottom, KlinaraMetrics.sm)
                .disabled(!canWrite)
            }
        }
    }

    // MARK: Taslak

    private func loadDraftIfNeeded() {
        guard !didLoad, let profile = staffStore.profile(id: staffProfileId) else { return }
        var mapped: [String: SkillDraft] = [:]
        for skill in profile.services where skill.isActive {
            mapped[skill.serviceId] = SkillDraft(
                isEnabled: true,
                customDurationMinutes: skill.customDurationMinutes,
                customPriceMinor: skill.customPriceMinor,
                branchId: skill.branchId
            )
        }
        draft = mapped
        originalDraft = mapped
        didLoad = true
    }

    private func save() async {
        error = nil
        saved = false
        let skills = draft
            .filter { $0.value.isEnabled }
            .map { serviceId, value in
                StaffServiceSkillInput(
                    serviceId: serviceId,
                    branchId: value.branchId,
                    customDurationMinutes: value.customDurationMinutes,
                    customPriceMinor: value.customPriceMinor,
                    isActive: true
                )
            }

        do {
            let updated = try await staffStore.replaceSkills(id: staffProfileId, skills: skills)
            didLoad = false
            _ = updated
            loadDraftIfNeeded()
            saved = true
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
