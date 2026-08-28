import SwiftUI

/// Müşteri kartının iletişim izni bölümü.
///
/// Bölüm yalnız `notification:read` varsa çizilir. Müşteri okuma modeli bu
/// bilgiyi taşımıyor — ayrı bir çağrı ve ayrı bir izin gerekiyor — ve izinsiz
/// bir kullanıcıya boş bir kart göstermek "bu müşterinin izin kaydı yok"
/// demek olurdu; oysa bilmiyoruz.
///
/// Dipnot Ek M'in kararını tekrarlıyor çünkü burası kullanıcının onu yanlış
/// anlamaya en yatkın olduğu yer: izni iptal etmek randevu hatırlatmasını
/// **durdurmaz**.
struct CustomerOptOutSection: View {

    let session: AppSession
    let store: CustomerOptOutStore

    @State private var isEditing = false
    @State private var error: APIError?

    private var canWrite: Bool { session.can(Permissions.notificationManage) }

    var body: some View {
        KlinaraCard(
            title: "İletişim izni",
            footnote: "İzin iptali yalnız ticari iletileri durdurur. Randevu onayı ve hatırlatması işlemsel mesajdır ve gitmeye devam eder."
        ) {
            if let error {
                ErrorBanner(error: error)
                KlinaraDivider()
            }
            content
        }
        .task { await store.load() }
        .sheet(isPresented: $isEditing) {
            CustomerOptOutSheet(store: store)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .loading:
            ProgressView()
                .tint(KlinaraColor.sage)
                .frame(maxWidth: .infinity)
                .padding(KlinaraMetrics.lg)

        case .failed(let failure):
            ErrorBanner(error: failure, onRetry: { Task { await store.load() } })

        case .loaded(let records):
            if records.isEmpty {
                KlinaraRow(
                    label: "Durum",
                    value: "İzin veriliyor",
                    detail: "Müşteri ticari ileti almayı kapatmamış."
                )
            } else {
                ForEach(Array(records.enumerated()), id: \.element.id) { index, record in
                    if index > 0 { KlinaraDivider() }
                    recordRow(record)
                }
            }

            if canWrite {
                KlinaraDivider()
                KlinaraButton(
                    title: records.isEmpty ? "Ticari iletiyi kapat" : "İzin kayıtlarını düzenle",
                    kind: .secondary,
                    icon: "hand.raised",
                    isEnabled: !store.isSaving
                ) {
                    isEditing = true
                }
                .padding(KlinaraMetrics.md)
            }
        }
    }

    private func recordRow(_ record: OptOutRecord) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(spacing: KlinaraMetrics.sm) {
                Text(record.channelLabel)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity, alignment: .leading)

                KlinaraBadge(text: "Kapalı", tone: .warning)
            }

            Text("\(record.source.turkishName) · \(session.clock.formatDate(record.createdAt))")
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(KlinaraMetrics.md)
    }
}

/// İzin kapatma / geri alma sayfası.
///
/// Kanal seçimi boş bırakılabilir ve bu **tüm kanallar** demektir — sunucu da
/// `channel: null`'ı böyle yorumluyor. "Hepsi" ayrı bir seçenek olarak
/// gösteriliyor ki kullanıcı boş bırakmanın ne anlama geldiğini tahmin etmesin.
struct CustomerOptOutSheet: View {

    let store: CustomerOptOutStore

    @State private var scope: OptOutScope = .allChannels
    @State private var source: OptOutSource = .customerRequest
    @State private var note = ""
    @State private var error: APIError?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        KlinaraFormScaffold(
            title: "İletişim izni",
            saveTitle: "Kapat",
            isDirty: true,
            isSaving: store.isSaving,
            error: error,
            onSave: { await optOut() }
        ) {
            scopeSection
            sourceSection
            if !store.records.isEmpty {
                revokeSection
            }
        }
    }

    private var scopeSection: some View {
        KlinaraFormSection(
            title: "Kapsam",
            footnote: "Kapsamı kapattığınızda bu müşteriye o kanaldan pazarlama mesajı gönderilmez."
        ) {
            KlinaraChipGrid(
                options: OptOutScope.allCases,
                title: \.turkishName,
                isSelected: { $0 == scope },
                onTap: { scope = $0 }
            )
            .padding(KlinaraMetrics.md)
        }
    }

    private var sourceSection: some View {
        KlinaraFormSection(
            title: "Kaynak",
            footnote: "Kaydın nereden geldiği denetim izinde kalır."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraChipGrid(
                    options: OptOutSource.allCases,
                    title: \.turkishName,
                    isSelected: { $0 == source },
                    onTap: { source = $0 }
                )
                KlinaraTextField(
                    label: "Not (isteğe bağlı)",
                    text: $note,
                    placeholder: "Örn. telefonda talep etti",
                    autocapitalization: .sentences
                )
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private var revokeSection: some View {
        KlinaraFormSection(
            title: "Mevcut kayıtlar",
            footnote: "Geri alınan kayıt silinmez; iptal tarihiyle damgalanır."
        ) {
            ForEach(Array(store.records.enumerated()), id: \.element.id) { index, record in
                if index > 0 { KlinaraDivider() }
                HStack {
                    Text(record.channelLabel)
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button("Geri al") {
                        Task { await revoke(record.channel) }
                    }
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.sageDeep)
                    .disabled(store.isSaving)
                }
                .padding(KlinaraMetrics.md)
            }
        }
    }

    private func optOut() async {
        error = nil
        do {
            try await store.optOut(
                channel: scope.channel,
                source: source,
                note: note.isEmpty ? nil : note
            )
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }

    private func revoke(_ channel: NotificationChannel?) async {
        error = nil
        do {
            try await store.revoke(channel: channel)
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}

/// "Tüm kanallar" sunucuda `channel: null`. Opsiyoneli ekrana sızdırmak
/// yerine adı olan bir seçenek: kullanıcı boş bırakmanın anlamını tahmin etmemeli.
private enum OptOutScope: String, CaseIterable, Identifiable {
    case allChannels
    case whatsapp
    case sms
    case email
    case push

    var id: String { rawValue }

    var channel: NotificationChannel? {
        switch self {
        case .allChannels: return nil
        case .whatsapp: return .whatsapp
        case .sms: return .sms
        case .email: return .email
        case .push: return .push
        }
    }

    var turkishName: String {
        channel?.turkishName ?? "Tüm kanallar"
    }
}
