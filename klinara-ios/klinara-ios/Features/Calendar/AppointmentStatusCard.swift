import SwiftUI

/// Randevu detayındaki durum bölümü: yaşam döngüsü şeridi + sıradaki eylemler.
///
/// Eski hâli, geçiş hedeflerini `chevron.right`li satırlar olarak listeliyordu;
/// satır + ok kalıbı iOS'ta "alt sayfaya git" demek, oysa dokunuş bir sayfa
/// açmıyor, durumu değiştiriyordu. Burada iki ayrı iş iki ayrı görünüm:
///
/// - **Şerit** (salt okunur): randevunun akıştaki yeri. Dokunulmaz, çünkü
///   adımlar arasında atlamak sunucunun geçiş tablosunda zaten yok.
/// - **Eylemler**: gerçek düğmeler. Tek birincil eylem sıradaki adımı yapar;
///   yan yollar (onayla, gelmedi, yeniden aç) ikincil düğme olarak durur.
///
/// Hangi düğmenin çizileceğini ``AppointmentStatus/allowedTransitions(canReopen:)``
/// belirler; burada yalnız o kümenin **sunumu** var. İptal bu karttan bilinçli
/// olarak dışarıda: yıkıcı ve gerekçe istiyor, ayrı düğme ve sheet'i var.
struct AppointmentStatusCard: View {

    let status: AppointmentStatus
    let canReopen: Bool
    let onSelect: (AppointmentStatus) -> Void

    private var actions: [AppointmentStatus] {
        status.allowedTransitions(canReopen: canReopen).filter { $0 != .cancelled }
    }

    private var primary: AppointmentStatus? {
        actions.first { $0.actionKind(from: status) == .primary }
    }

    private var others: [AppointmentStatus] {
        actions.filter { $0 != primary }
    }

    var body: some View {
        // Yapılacak bir şey yoksa kart hiç çizilmez: tamamlanmış ve yeniden
        // açma yetkisi olmayan bir randevuda boş bir "Durum" kartı gürültü.
        if !actions.isEmpty {
            KlinaraCard(title: "Durum") {
                VStack(spacing: KlinaraMetrics.md) {
                    if status.lifecycleIndex != nil {
                        StatusTimeline(current: status)
                    }

                    VStack(spacing: KlinaraMetrics.sm) {
                        if let primary {
                            KlinaraButton(
                                title: primary.actionTitle(from: status),
                                icon: primary.actionIcon(from: status)
                            ) { onSelect(primary) }
                        }

                        if !others.isEmpty {
                            HStack(spacing: KlinaraMetrics.sm) {
                                ForEach(others) { other in
                                    KlinaraButton(
                                        title: other.actionTitle(from: status),
                                        kind: other.actionKind(from: status),
                                        icon: other.actionIcon(from: status)
                                    ) { onSelect(other) }
                                }
                            }
                        }
                    }
                }
                .padding(KlinaraMetrics.md)
            }
        }
    }
}

// MARK: - Şerit

/// Beş adımlı ana akış. Yan durumlar (gelmedi, iptal) şeritte yer almaz:
/// akışın dışına çıkmışlardır ve zaten eylem alabilecekleri durumlar değil.
private struct StatusTimeline: View {

    let current: AppointmentStatus

    private static let steps: [AppointmentStatus] = [
        .scheduled, .confirmed, .arrived, .inProgress, .completed,
    ]

    private var currentIndex: Int { current.lifecycleIndex ?? 0 }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(Self.steps.enumerated()), id: \.element) { index, step in
                column(index: index, step: step)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Durum: \(current.turkishName)")
        .accessibilityValue("\(currentIndex + 1). adım, \(Self.steps.count) adımdan")
    }

    private func column(index: Int, step: AppointmentStatus) -> some View {
        let isCurrent = index == currentIndex
        return VStack(spacing: KlinaraMetrics.sm) {
            ZStack {
                // Bağlantı çizgisi iki yarım: soldaki "bu adıma gelindi mi",
                // sağdaki "bu adım geçildi mi". İlk ve son adımda dış yarım yok.
                HStack(spacing: 0) {
                    line(filled: index <= currentIndex).opacity(index == 0 ? 0 : 1)
                    line(filled: index < currentIndex)
                        .opacity(index == Self.steps.count - 1 ? 0 : 1)
                }
                marker(index: index)
            }
            .frame(height: 22)

            Text(step.turkishName)
                .font(.system(size: 11, weight: isCurrent ? .semibold : .regular))
                .foregroundStyle(isCurrent ? KlinaraColor.charcoal : KlinaraColor.charcoalMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }

    private func line(filled: Bool) -> some View {
        Rectangle()
            .fill(filled ? KlinaraColor.sage : KlinaraColor.border)
            .frame(height: 2)
    }

    @ViewBuilder
    private func marker(index: Int) -> some View {
        if index < currentIndex {
            Circle()
                .fill(KlinaraColor.sage)
                .frame(width: 20, height: 20)
                .overlay(
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(KlinaraColor.surfaceRaised)
                )
        } else if index == currentIndex {
            Circle()
                .fill(KlinaraColor.sageSoft)
                .frame(width: 22, height: 22)
                .overlay(Circle().stroke(KlinaraColor.sage, lineWidth: 2))
                .overlay(Circle().fill(KlinaraColor.sage).frame(width: 8, height: 8))
        } else {
            Circle()
                .fill(KlinaraColor.surfaceRaised)
                .frame(width: 20, height: 20)
                .overlay(
                    Circle().stroke(KlinaraColor.border, lineWidth: KlinaraMetrics.borderWidth * 1.5)
                )
        }
    }
}

// MARK: - Sunum

extension AppointmentStatus {

    /// Ana akıştaki sırası; akış dışı durumlarda (`noShow`, `cancelled`) `nil`.
    fileprivate var lifecycleIndex: Int? {
        switch self {
        case .scheduled: 0
        case .confirmed: 1
        case .arrived: 2
        case .inProgress: 3
        case .completed: 4
        case .noShow, .cancelled: nil
        }
    }

    /// Bu duruma **geçiren** düğmenin metni. Durumun adı ("İşlemde") bir
    /// eylem değil; düğme fiil söylemeli.
    fileprivate func actionTitle(from source: AppointmentStatus) -> String {
        if source == .completed && self == .inProgress { return "Yeniden aç" }
        return switch self {
        case .scheduled: "Planlandı"
        case .confirmed: "Onayla"
        case .arrived: "Geldi"
        case .inProgress: "İşleme başla"
        case .completed: "Tamamla"
        case .noShow: "Gelmedi"
        case .cancelled: "İptal et"
        }
    }

    fileprivate func actionIcon(from source: AppointmentStatus) -> String? {
        if source == .completed && self == .inProgress { return "arrow.uturn.backward" }
        return switch self {
        case .confirmed: "checkmark.circle"
        case .arrived: "figure.walk.arrival"
        case .inProgress: "play.fill"
        case .completed: "checkmark.seal"
        case .noShow: "person.slash"
        case .scheduled, .cancelled: nil
        }
    }

    /// `source` durumundayken bu geçişin düğme ağırlığı.
    ///
    /// Birincil: akışı ileri taşıyan adım. `scheduled`da hem "Onayla" hem
    /// "Geldi" ileri gidiyor; klinikte pratikte olan "Geldi", onay ise çoğunlukla
    /// WhatsApp yanıtıyla kendiliğinden düşüyor — bu yüzden onay ikincil.
    fileprivate func actionKind(from source: AppointmentStatus) -> KlinaraButtonKind {
        switch (source, self) {
        case (.scheduled, .arrived), (.confirmed, .arrived),
             (.arrived, .inProgress), (.inProgress, .completed):
            .primary
        case (_, .noShow):
            .tertiary
        default:
            .secondary
        }
    }

    /// Geçişin onay penceresi isteyip istemediği.
    ///
    /// Geri alınması pahalı olanlar: `completed` seans hakkını düşürür ve hizmet
    /// bedelini yazar, `noShow` takip mesajı planlar, `completed`tan yeniden
    /// açmak bunların ters kaydını üretir. Gerisi tek dokunuşla geri alınabilir.
    func needsConfirmation(from source: AppointmentStatus) -> Bool {
        self == .completed || self == .noShow || source == .completed
    }
}

#Preview("Durum kartı") {
    ScrollView {
        VStack(spacing: KlinaraMetrics.lg) {
            AppointmentStatusCard(status: .scheduled, canReopen: false) { _ in }
            AppointmentStatusCard(status: .arrived, canReopen: false) { _ in }
            AppointmentStatusCard(status: .inProgress, canReopen: false) { _ in }
            AppointmentStatusCard(status: .completed, canReopen: true) { _ in }
        }
        .padding(KlinaraMetrics.screenInset)
    }
    .background(KlinaraColor.surface)
}
