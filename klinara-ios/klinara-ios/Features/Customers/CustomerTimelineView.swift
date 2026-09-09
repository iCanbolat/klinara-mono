import SwiftUI

/// Müşterinin birleşik zaman çizelgesi: randevu + not, tek akış.
///
/// Faz 3'te kartta ayrı bir randevu listesi vardı; zaman çizelgesi randevuları
/// zaten getirdiği için o istek kaldırıldı — ikisi birden aynı veriyi iki kez
/// çekerdi.
struct CustomerTimelineView: View {

    let session: AppSession
    let record: CustomerRecordStore
    /// Not satırına dokunulduğunda düzenlemeyi açar.
    var onEditNote: (String) -> Void

    private var clock: BranchClock { session.clock }
    private var query: TimelineQuery { record.timelineQuery }

    var body: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            filterBar
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        switch record.timeline {
        case .loading:
            KlinaraCard(title: "Zaman çizelgesi") {
                ProgressView()
                    .tint(KlinaraColor.sage)
                    .frame(maxWidth: .infinity)
                    .padding(KlinaraMetrics.lg)
            }

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await record.loadTimeline() } })

        case .loaded(let entries):
            KlinaraCard(title: "Zaman çizelgesi", footnote: footnote) {
                if entries.isEmpty {
                    // "Kayıt yok" ile "bu filtreyle kayıt yok" farklı şeyler:
                    // ilki kullanıcıyı bir şey eklemeye, ikincisi filtreyi
                    // gevşetmeye yönlendirir.
                    KlinaraRow(
                        label: query.isFiltered ? "Bu filtreyle kayıt yok" : "Henüz kayıt yok",
                        detail: query.isFiltered ? "Filtreyi temizleyip yeniden bakın." : nil
                    )
                } else {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { KlinaraDivider() }
                        row(entry)
                    }
                }
            }

            if record.canLoadMore {
                loadMoreTrigger
            }
        }
    }

    // MARK: Filtre

    /// Tür çipleri + tarih menüsü.
    ///
    /// Filtre **sunucuda** uygulanıyor: yüklenmiş sayfalar üzerinde süzmek,
    /// "son 3 ay" diyen kullanıcıya elindeki ilk 50 kaydın içindeki son 3 ayı
    /// göstermek olurdu — eksik bir cevabı tam bir cevap gibi sunmak.
    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: KlinaraMetrics.sm) {
                rangeMenu

                ForEach(TimelineKind.allCases) { kind in
                    chip(title: kind.turkishName, isSelected: query.kinds.contains(kind)) {
                        var updated = query
                        // Çoklu seçim: çipler birbirini dışlamıyor, "randevu
                        // VE onam" meşru bir soru.
                        if updated.kinds.contains(kind) {
                            updated.kinds.remove(kind)
                        } else {
                            updated.kinds.insert(kind)
                        }
                        Task { await record.applyTimelineFilter(updated) }
                    }
                }

                if query.isFiltered {
                    Button("Temizle") { Task { await record.clearTimelineFilter() } }
                        .klinaraText(.button)
                        .foregroundStyle(KlinaraColor.sageDeep)
                        .frame(height: 34)
                }
            }
            .padding(.horizontal, 1)
        }
    }

    private var rangeMenu: some View {
        Menu {
            Button("Tümü") { apply(range: nil) }
            Button("Son 3 ay") { apply(range: 3) }
            Button("Son 1 yıl") { apply(range: 12) }
        } label: {
            chipLabel(title: rangeTitle, isSelected: query.from != nil || query.to != nil)
        }
        .accessibilityLabel("Tarih aralığı, \(rangeTitle)")
    }

    private var rangeTitle: String {
        guard let from = query.from else { return "Tüm zamanlar" }
        return "\(clock.formatDate(from))'ten beri"
    }

    /// Aralığın üst ucu **açık bırakılıyor**: "son 3 ay" bugünü de kapsıyor ve
    /// bir üst sınır koymak, bugün eklenen kaydı listeden düşürürdü.
    private func apply(range months: Int?) {
        var updated = query
        updated.from = months.map { clock.adding(months: -$0, to: Date()) }
        updated.to = nil
        Task { await record.applyTimelineFilter(updated) }
    }

    private func chip(
        title: String,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) { chipLabel(title: title, isSelected: isSelected) }
            .buttonStyle(.plain)
            .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private func chipLabel(title: String, isSelected: Bool) -> some View {
        Text(title)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(isSelected ? KlinaraColor.surfaceRaised : KlinaraColor.charcoal)
            .padding(.horizontal, KlinaraMetrics.md)
            .frame(height: 34)
            .background(isSelected ? KlinaraColor.sageDeep : KlinaraColor.surfaceRaised)
            .overlay(
                Capsule().stroke(
                    isSelected ? KlinaraColor.sageDeep : KlinaraColor.border,
                    lineWidth: KlinaraMetrics.borderWidth
                )
            )
            .clipShape(.capsule)
            .contentShape(.capsule)
    }

    /// Klinik notlar sunucudan hiç gelmiyorsa bunu söylemek gerekiyor:
    /// sessizce eksik bir geçmiş, tam bir geçmiş gibi görünürdü.
    private var footnote: String? {
        record.canReadMedical
            ? nil
            : "İşlem ve iç notlar bu rolde görüntülenemez; listede yer almazlar."
    }

    @ViewBuilder
    private func row(_ entry: TimelineEntry) -> some View {
        switch entry {
        case .appointment(let header, let payload):
            NavigationLink {
                AppointmentDetailView(session: session, entryId: header.id)
            } label: {
                KlinaraRow(
                    label: "Randevu",
                    detail: "\(clock.formatDateTime(payload.startsAt)) · "
                        + Money.format(minor: payload.totalMinor)
                ) {
                    KlinaraBadge(
                        text: payload.status.turkishName,
                        tone: payload.status.badgeTone
                    )
                }
            }
            .buttonStyle(.plain)

        case .note(let header, let payload):
            Button {
                onEditNote(header.id)
            } label: {
                KlinaraRow(
                    label: payload.body,
                    detail: "\(payload.kind.turkishName) · "
                        + clock.formatDateTime(entry.occurredAt)
                ) {
                    Image(systemName: payload.kind.icon)
                        .font(.system(size: 13))
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .buttonStyle(.plain)

        case .consent(_, let payload):
            // Onam satırı SÜRÜMÜ taşıyor: "kabul etti" tek başına kanıt değil,
            // hangi metni kabul ettiği kanıt. Metnin gövdesi burada yok —
            // 20 bin karakterlik bir aydınlatma metni listeye binmemeli.
            KlinaraRow(
                label: "KVKK onayı",
                detail: (payload.version.map { "Sürüm \($0) · " } ?? "")
                    + clock.formatDateTime(entry.occurredAt)
            ) {
                Image(systemName: "checkmark.seal")
                    .font(.system(size: 13))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }

        case .unknown(_, let kind):
            // Bilinmeyen olay YUTULMUYOR: sunucu yeni bir kol eklediğinde
            // (paket, tahsilat) eski istemci geçmişi eksik göstermemeli.
            KlinaraRow(
                label: "Bu sürümde gösterilemeyen kayıt",
                detail: "\(kind) · \(clock.formatDateTime(entry.occurredAt))"
            ) {
                Image(systemName: "questionmark.circle")
                    .font(.system(size: 13))
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
        }
    }

    private var loadMoreTrigger: some View {
        HStack {
            Spacer()
            ProgressView().tint(KlinaraColor.sage)
            Spacer()
        }
        .padding(.vertical, KlinaraMetrics.md)
        .onAppear { Task { await record.loadMoreTimeline() } }
    }
}
