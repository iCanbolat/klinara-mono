import SwiftUI

/// Şube hatırlatma ayarları — randevudan kaç saat önce hatırlatılacağı ve
/// gelmedi takibi.
///
/// Ekranın tek incelikli yeri **override ayrımı**: `GET` çözülmüş ayarı
/// döndürüyor, yani şubenin kendi listesi yoksa kiracı varsayılanı geliyor.
/// Bunu göstermezsek kullanıcı kiracı varsayılanını şubeye özel sanır ve bir
/// şubede yaptığını hepsinde yaptığını düşünür. `isBranchOverride` bu yüzden
/// ekranda bir rozet, bir dipnot ve bir "varsayılana dön" düğmesi olarak
/// karşılık buluyor.
///
/// ``BranchHoursView`` gibi yerel taslak tutup tek "Kaydet" ile gönderir:
/// saat başına otomatik kayıt, yarım kalan bir istekte listenin geri kalanını
/// belirsiz bırakırdı.
struct ReminderSettingsView: View {

    let session: AppSession

    @State private var store: NotificationSettingsStore?
    @State private var draft: Draft?
    @State private var original: Draft?
    @State private var error: APIError?
    @State private var newHourText = ""

    private var canWrite: Bool { session.can(Permissions.notificationManage) }
    private var isDirty: Bool { draft != nil && draft != original }
    private var isSaving: Bool { store?.isSaving ?? false }

    struct Draft: Equatable {
        var hours: [Int]
        var isBranchOverride: Bool
        var followupEnabled: Bool
        var followupDelayHours: Int
    }

    var body: some View {
        ZStack {
            KlinaraColor.surface.ignoresSafeArea()
            content
        }
        .navigationTitle("Hatırlatma ayarları")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if canWrite, isDirty {
                    Button("Kaydet") { Task { await save() } }
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.sageDeep)
                        .disabled(isSaving || !isValid)
                } else {
                    BranchMenu(session: session)
                }
            }
        }
        // Şube değişince yeniden çekilir: hatırlatma ayarı şube kapsamlı ve
        // kullanıcı Kadıköy'ü seçip Nişantaşı'nınkini düzenlemeye devam ederdi.
        .task(id: session.selectedBranchId) { await load() }
        .overlay {
            if isSaving { AuthLoadingOverlay(message: "Kaydediliyor…") }
        }
    }

    // MARK: İçerik

    @ViewBuilder
    private var content: some View {
        if let store {
            switch store.reminderState {
            case .loading:
                ProgressView()
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .failed(let failure):
                VStack {
                    ErrorBanner(error: failure, onRetry: { Task { await load() } })
                    Spacer()
                }
                .padding(KlinaraMetrics.screenInset)

            case .loaded(let settings):
                if let draft {
                    form(draft, settings: settings)
                }
            }
        } else {
            ProgressView()
                .tint(KlinaraColor.sage)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func form(_ draft: Draft, settings: BranchReminderSettings) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let error, !error.isFieldScoped {
                    ErrorBanner(error: error)
                }

                scopeCard(settings)
                hoursCard(draft)
                followupCard(draft)
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
    }

    private func scopeCard(_ settings: BranchReminderSettings) -> some View {
        KlinaraCard(title: "Kapsam") {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                HStack(spacing: KlinaraMetrics.sm) {
                    Text(session.selectedBranch?.name ?? "Şube")
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    KlinaraBadge(
                        text: settings.isBranchOverride ? "Şubeye özel" : "Kiracı varsayılanı",
                        tone: settings.isBranchOverride ? .positive : .muted
                    )
                }

                Text(settings.isBranchOverride
                    ? "Bu şube kendi hatırlatma saatlerini kullanıyor. Diğer şubeler etkilenmez."
                    : "Bu şube kiracı varsayılanını kullanıyor. Buradan kaydettiğiniz saatler yalnız bu şubeye yazılır.")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if canWrite, settings.isBranchOverride {
                    // Boş dizi göndermek override'ı KALDIRIR — "hiç hatırlatma
                    // gönderme" demek değil. Düğmenin metni bunu söylemeli.
                    KlinaraButton(
                        title: "Kiracı varsayılanına dön",
                        kind: .secondary,
                        icon: "arrow.uturn.backward",
                        isEnabled: !isSaving
                    ) {
                        Task { await resetToTenantDefault() }
                    }
                }
            }
            // ``KlinaraCard`` içeriğine yatay boşluk EKLEMEZ; serbest içerik
            // dolgusunu kendisi taşır (``KlinaraRow`` ile aynı `md`).
            .padding(KlinaraMetrics.md)
        }
    }

    private func hoursCard(_ draft: Draft) -> some View {
        KlinaraCard(
            title: "Hatırlatma saatleri",
            footnote: "En çok 5 hatırlatma; her biri randevudan 1–720 saat önce. Varsayılan 24 ve 2 saat önce."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                if draft.hours.isEmpty {
                    Text("Hatırlatma saati yok.")
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    FlowLayout(spacing: KlinaraMetrics.sm) {
                        ForEach(draft.hours.sorted(by: >), id: \.self) { hour in
                            hourChip(hour)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if canWrite {
                    KlinaraTextField(
                        label: "Saat ekle",
                        text: $newHourText,
                        placeholder: "örn. 48",
                        keyboardType: .numberPad
                    )
                    KlinaraButton(
                        title: "Ekle",
                        kind: .secondary,
                        isEnabled: canAddHour
                    ) {
                        addHour()
                    }
                    if draft.hours.count >= UpdateBranchReminderSettingsInput.maxReminderCount {
                        Text("En çok 5 hatırlatma tanımlanabilir.")
                            .klinaraText(.bodyM)
                            .font(.footnote)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private func hourChip(_ hour: Int) -> some View {
        HStack(spacing: KlinaraMetrics.xs) {
            Text("\(hour) saat önce")
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoal)
            if canWrite {
                Button {
                    draft?.hours.removeAll { $0 == hour }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
                .accessibilityLabel("\(hour) saat önceki hatırlatmayı kaldır")
            }
        }
        .padding(.horizontal, KlinaraMetrics.sm)
        .padding(.vertical, KlinaraMetrics.xs)
        .background(KlinaraColor.sageSoft)
        .clipShape(.capsule)
    }

    private func followupCard(_ draft: Draft) -> some View {
        KlinaraCard(
            title: "Gelmedi takibi",
            footnote: "Randevu \"gelmedi\" işaretlendikten sonra müşteriye tek bir takip mesajı gider."
        ) {
            KlinaraToggleRow(
                label: "Takip mesajı gönder",
                isOn: Binding(
                    get: { self.draft?.followupEnabled ?? false },
                    set: { self.draft?.followupEnabled = $0 }
                ),
                isEnabled: canWrite
            )
            if draft.followupEnabled {
                KlinaraDivider()
                KlinaraStepperRow(
                    label: "Gecikme",
                    detail: "Randevu bitiminden ne kadar sonra gönderilsin",
                    value: Binding(
                        get: { self.draft?.followupDelayHours ?? 2 },
                        set: { self.draft?.followupDelayHours = $0 }
                    ),
                    range: UpdateBranchReminderSettingsInput.followupDelayRange,
                    step: 1,
                    isEnabled: canWrite,
                    format: { "\($0) saat" }
                )
            }
        }
    }

    // MARK: Doğrulama

    private var canAddHour: Bool {
        guard let draft, let value = Int(newHourText) else { return false }
        guard UpdateBranchReminderSettingsInput.hourRange.contains(value) else { return false }
        guard !draft.hours.contains(value) else { return false }
        return draft.hours.count < UpdateBranchReminderSettingsInput.maxReminderCount
    }

    private var isValid: Bool {
        guard let draft else { return false }
        return draft.hours.count <= UpdateBranchReminderSettingsInput.maxReminderCount
            && draft.hours.allSatisfy { UpdateBranchReminderSettingsInput.hourRange.contains($0) }
    }

    private func addHour() {
        guard canAddHour, let value = Int(newHourText) else { return }
        draft?.hours.append(value)
        newHourText = ""
    }

    // MARK: Yükleme ve kaydetme

    private func load() async {
        guard let branchId = session.selectedBranchId else { return }
        error = nil
        let created = store ?? NotificationSettingsStore(service: session.services.notifications)
        store = created
        await created.loadReminderSettings(branchId: branchId)
        guard let settings = created.reminderSettings else { return }
        let loaded = Draft(
            hours: settings.reminderHoursBefore,
            isBranchOverride: settings.isBranchOverride,
            followupEnabled: settings.noShowFollowupEnabled,
            followupDelayHours: settings.noShowFollowupDelayHours
        )
        draft = loaded
        original = loaded
    }

    private func save() async {
        guard let branchId = session.selectedBranchId, let store, let draft else { return }
        error = nil
        do {
            let saved = try await store.updateReminderSettings(
                branchId: branchId,
                UpdateBranchReminderSettingsInput(
                    reminderHoursBefore: draft.hours.sorted(by: >),
                    noShowFollowupEnabled: draft.followupEnabled,
                    noShowFollowupDelayHours: draft.followupDelayHours
                )
            )
            let refreshed = Draft(
                hours: saved.reminderHoursBefore,
                isBranchOverride: saved.isBranchOverride,
                followupEnabled: saved.noShowFollowupEnabled,
                followupDelayHours: saved.noShowFollowupDelayHours
            )
            self.draft = refreshed
            original = refreshed
        } catch {
            self.error = error as? APIError ?? .network
        }
    }

    private func resetToTenantDefault() async {
        guard let branchId = session.selectedBranchId, let store else { return }
        error = nil
        do {
            let saved = try await store.updateReminderSettings(
                branchId: branchId,
                UpdateBranchReminderSettingsInput(reminderHoursBefore: [])
            )
            let refreshed = Draft(
                hours: saved.reminderHoursBefore,
                isBranchOverride: saved.isBranchOverride,
                followupEnabled: saved.noShowFollowupEnabled,
                followupDelayHours: saved.noShowFollowupDelayHours
            )
            draft = refreshed
            original = refreshed
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
