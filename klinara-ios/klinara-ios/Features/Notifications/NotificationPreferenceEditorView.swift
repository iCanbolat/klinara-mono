import SwiftUI

/// Bir olayın kanal önceliğini ve sessiz saatlerini düzenler.
///
/// Kanal listesi **sıralı**: sunucu bunu "öncelik sırasında denenecek kanallar"
/// olarak okuyor ve ilk başarılı gönderimde duruyor. Ekranın onu bir çoklu
/// seçim kutusu gibi göstermesi, sıranın anlamını gizlerdi — bu yüzden
/// seçilenler numaralı ve taşınabilir bir liste.
///
/// Sessiz saatin iki ucu **birlikte** gönderilir: sunucu yalnız birini
/// aldığında `VALIDATION_FAILED` veriyor.
struct NotificationPreferenceEditorView: View {

    let session: AppSession
    let store: NotificationSettingsStore
    let preference: NotificationPreference

    @State private var channels: [NotificationChannel] = []
    @State private var hasQuietHours = false
    @State private var quietStart: ClockTime? = ClockTime(hour: 21, minute: 0)
    @State private var quietEnd: ClockTime? = ClockTime(hour: 9, minute: 0)
    @State private var scope: PreferenceScope = .tenant
    @State private var error: APIError?
    @State private var didLoad = false
    @Environment(\.dismiss) private var dismiss

    private var canWrite: Bool { session.can(Permissions.notificationManage) }

    var body: some View {
        KlinaraFormScaffold(
            title: preference.event.turkishName,
            canSave: true,
            isDirty: didLoad && isDirty,
            isReadOnly: !canWrite,
            isSaving: store.isSaving,
            error: error,
            onSave: { await submit() }
        ) {
            scopeSection
            channelSection
            quietHoursSection
        }
        .task {
            guard !didLoad else { return }
            channels = preference.channels
            scope = preference.branchId == nil ? .tenant : .branch
            if let start = ClockTime(preference.quietHoursStart),
               let end = ClockTime(preference.quietHoursEnd) {
                quietStart = start
                quietEnd = end
                hasQuietHours = true
            }
            didLoad = true
        }
    }

    // MARK: Bölümler

    private var scopeSection: some View {
        KlinaraFormSection(
            title: "Kapsam",
            footnote: "Şubeye özel bir satır, kiracı varsayılanını yalnız o şubede ezer."
        ) {
            KlinaraRow(
                label: "Olay",
                value: preference.event.turkishName,
                detail: preference.event.explanation
            )
            KlinaraDivider()
            KlinaraRow(
                label: "Tür",
                value: preference.kind.turkishName,
                detail: preference.kind.explanation
            )
            KlinaraDivider()
            if let branchName = session.selectedBranch?.name {
                KlinaraSegmentedPicker(
                    options: PreferenceScope.allCases,
                    selection: $scope,
                    title: { $0 == .tenant ? "Tüm klinik" : branchName }
                )
                .disabled(!canWrite)
                // ``KlinaraCard`` içeriğine yatay boşluk eklemiyor; serbest
                // içerik dolgusunu kendisi taşır (``KlinaraRow`` ile aynı `md`).
                .padding(KlinaraMetrics.md)
            }
        }
    }

    private var channelSection: some View {
        KlinaraFormSection(
            title: "Kanal önceliği",
            footnote: "Kanallar sırayla denenir; ilk başarılı gönderimde durulur. Liste boşsa bu olay için mesaj üretilmez."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                if channels.isEmpty {
                    Text("Bu olay kapalı.")
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ForEach(Array(channels.enumerated()), id: \.element) { index, channel in
                        HStack(spacing: KlinaraMetrics.sm) {
                            Text("\(index + 1).")
                                .klinaraText(.bodyM)
                                .foregroundStyle(KlinaraColor.charcoalMuted)

                            Label(channel.turkishName, systemImage: channel.icon)
                                .klinaraText(.bodyM)
                                .foregroundStyle(KlinaraColor.charcoal)
                                .frame(maxWidth: .infinity, alignment: .leading)

                            if !channel.isDeliverable {
                                KlinaraBadge(text: "Kurulu değil", tone: .muted)
                            }

                            if canWrite {
                                Button {
                                    move(channel, by: -1)
                                } label: {
                                    Image(systemName: "arrow.up")
                                }
                                .disabled(index == 0)
                                .accessibilityLabel("\(channel.turkishName) kanalını yukarı taşı")

                                Button {
                                    channels.removeAll { $0 == channel }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                }
                                .accessibilityLabel("\(channel.turkishName) kanalını kaldır")
                            }
                        }
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .padding(.vertical, KlinaraMetrics.xs)
                    }
                }

                if canWrite {
                    let available = NotificationChannel.allCases.filter { !channels.contains($0) }
                    if !available.isEmpty {
                        KlinaraDivider()
                        KlinaraChipGrid(
                            options: available,
                            title: \.turkishName,
                            isSelected: { _ in false },
                            badge: { $0.isDeliverable ? nil : "kurulu değil" },
                            onTap: { channels.append($0) }
                        )
                    }
                }
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private var quietHoursSection: some View {
        KlinaraFormSection(
            title: "Sessiz saatler",
            footnote: "Bu aralıkta üretilen mesaj gönderilmez, pencere kapanınca gönderilir. Saatler şubenin saat diliminde yorumlanır ve pencere gece yarısını aşabilir."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraToggleRow(
                    label: "Sessiz saat uygula",
                    isOn: $hasQuietHours,
                    isEnabled: canWrite
                )
                if hasQuietHours {
                    KlinaraDivider()
                    KlinaraTimeField(
                        label: "Başlangıç",
                        time: $quietStart,
                        isEnabled: canWrite,
                        timeZone: session.clock.timeZone
                    )
                    KlinaraTimeField(
                        label: "Bitiş",
                        time: $quietEnd,
                        isEnabled: canWrite,
                        timeZone: session.clock.timeZone
                    )
                    if let start = quietStart, let end = quietEnd, end <= start {
                        // Pencere gece yarısını aşabiliyor (21:00–09:00) ve bu bir
                        // hata değil; kullanıcı bunu bilmezse "bitiş başlangıçtan
                        // küçük" diye kendi kendini düzeltmeye çalışırdı.
                        Text("Pencere gece yarısını aşıyor: \(start.displayValue)'dan ertesi gün \(end.displayValue)'a kadar.")
                            .klinaraText(.bodyM)
                            .font(.footnote)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(KlinaraMetrics.md)
        }
    }

    // MARK: Durum

    private var isDirty: Bool {
        if channels != preference.channels { return true }
        if scope != (preference.branchId == nil ? .tenant : .branch) { return true }
        let hadQuietHours = preference.quietHoursStart != nil && preference.quietHoursEnd != nil
        if hasQuietHours != hadQuietHours { return true }
        guard hasQuietHours else { return false }
        return quietStart != ClockTime(preference.quietHoursStart)
            || quietEnd != ClockTime(preference.quietHoursEnd)
    }

    private func move(_ channel: NotificationChannel, by offset: Int) {
        guard let index = channels.firstIndex(of: channel) else { return }
        let target = index + offset
        guard channels.indices.contains(target) else { return }
        channels.swapAt(index, target)
    }

    private func submit() async {
        error = nil
        let input = UpsertNotificationPreferenceInput(
            branchId: scope == .branch ? session.selectedBranchId : nil,
            event: preference.event,
            channels: channels,
            // İkisi birlikte ya da hiç: sunucu yalnız birini aldığında
            // `VALIDATION_FAILED` döner.
            quietHoursStart: hasQuietHours ? quietStart?.wireValue : nil,
            quietHoursEnd: hasQuietHours ? quietEnd?.wireValue : nil
        )
        do {
            _ = try await store.upsertPreference(input)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }

    // Sunucu bu alanları bir zaman damgası değil, düz bir `"HH:MM"` metni
    // olarak taşıyor (şube saat diliminde yorumlanacak bir duvar saati).
    // ``ClockTime`` tam olarak bunun için var — `Date`e çevirmek, saniyeyi ve
    // yaz saati geçişini denkleme sokar ve hiçbir şey kazandırmazdı.
}

private enum PreferenceScope: String, CaseIterable, Identifiable {
    case tenant
    case branch

    var id: String { rawValue }
}
