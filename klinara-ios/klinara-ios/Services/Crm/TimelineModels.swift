import Foundation

/// Müşteri zaman çizelgesi — `GET /customers/:id/timeline`.
///
/// Sunucu randevu, not ve onam kabullerini `union all` ile TEK sorguda, tek
/// sıralamada birleştiriyor; sözleşme her kolun `kind` + `payload` döndürmesi.
/// Faz 5 (paket) ve Faz 6 (tahsilat) buraya kendi kolunu ekleyecek.

/// Çizelgedeki bir olayın türü — sunucudaki `TIMELINE_KINDS` ile birebir.
///
/// ``TimelineEntry/unknown``ın karşılığı burada YOK ve olmamalı: bu tip
/// kullanıcının **süzebildiği** türleri sayıyor; bilinmeyen bir türü filtre
/// listesine koymak, adı olmayan bir kutucuk çizmek olurdu. Bilinmeyen olaylar
/// filtresiz listede yine görünüyor.
nonisolated enum TimelineKind: String, Sendable, CaseIterable, Identifiable {
    case appointment
    case note
    case consent

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .appointment: return "Randevu"
        case .note: return "Not"
        case .consent: return "Onam"
        }
    }
}

/// Çizelge sorgusu.
///
/// `kinds` boş küme "hiçbiri" DEĞİL, "süzme yok": sunucu da öyle yorumluyor ve
/// filtreyi temizlemenin sonucu boş bir liste olamaz.
nonisolated struct TimelineQuery: Sendable, Equatable {
    var kinds: Set<TimelineKind> = []
    /// Dahil.
    var from: Date?
    /// HARİÇ — takvim ve rapor uçlarındaki yarı açık aralık idiomu.
    var to: Date?

    var isFiltered: Bool { !kinds.isEmpty || from != nil || to != nil }

    /// Kaç filtre etkin — başlıktaki sayaç rozeti için. Tarih aralığı, iki ucu
    /// da dolu olsa **tek** filtre sayılıyor: kullanıcı onu tek bir seçim
    /// olarak yaptı.
    var activeCount: Int {
        (kinds.isEmpty ? 0 : 1) + ((from != nil || to != nil) ? 1 : 0)
    }
}

/// Tek bir olay.
///
/// **Neden enum:** `payload` türe göre değişiyor. Optional-ağırlıklı tek bir
/// struct, hangi alanın hangi olayda dolu olduğunu derleyiciye söyletmezdi.
///
/// ``unknown`` kolu **zorunlu**: sunucu yeni bir `kind` eklediğinde eski
/// istemci çözümlemede patlarsa müşteri kartını hiç açamaz. Bilinmeyen olay
/// sessizce yutulmuyor da — kullanıcıya "bu sürümde gösterilemeyen bir kayıt"
/// olarak çiziliyor ki eksik bir geçmiş, tam bir geçmiş gibi görünmesin.
nonisolated enum TimelineEntry: Decodable, Sendable, Identifiable, Equatable {

    case appointment(TimelineHeader, AppointmentTimelinePayload)
    case note(TimelineHeader, NoteTimelinePayload)
    case consent(TimelineHeader, ConsentTimelinePayload)
    case unknown(TimelineHeader, kind: String)

    var header: TimelineHeader {
        switch self {
        case .appointment(let header, _), .note(let header, _), .consent(let header, _),
            .unknown(let header, _):
            return header
        }
    }

    var id: String { header.id }

    /// Olayın gerçekleştiği an — UTC (`...Z`).
    var occurredAt: Date { header.occurredAt }

    private enum CodingKeys: String, CodingKey {
        case kind, id, occurredAt, payload
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        let header = TimelineHeader(
            id: try container.decode(String.self, forKey: .id),
            occurredAt: try container.decode(Date.self, forKey: .occurredAt)
        )

        switch kind {
        case "appointment":
            self = .appointment(
                header,
                try container.decode(AppointmentTimelinePayload.self, forKey: .payload)
            )
        case "note":
            self = .note(header, try container.decode(NoteTimelinePayload.self, forKey: .payload))
        case "consent":
            self = .consent(
                header,
                try container.decode(ConsentTimelinePayload.self, forKey: .payload)
            )
        default:
            self = .unknown(header, kind: kind)
        }
    }
}

nonisolated struct TimelineHeader: Sendable, Equatable {
    let id: String
    let occurredAt: Date
}

nonisolated struct AppointmentTimelinePayload: Decodable, Sendable, Equatable {
    let status: AppointmentStatus
    /// **`+00:00` offset'iyle** gelir — takvim uçlarındaki şube offset'i
    /// (`+03:00`) DEĞİL. Sebep: bu payload `jsonb_build_object` ile kuruluyor
    /// ve PostgreSQL `timestamptz`yi oturumun saat diliminde (UTC)
    /// serileştiriyor; `AppointmentResponseDto` ise şube offset'i uyguluyor.
    ///
    /// İkisi **aynı anı** gösterir ve ``KlinaraCoding`` her iki biçimi de
    /// çözer, dolayısıyla ekranda fark yok — ama sözleşme farkı gerçek ve
    /// fixture testiyle sabitleniyor.
    let startsAt: Date
    let endsAt: Date
    let branchId: String
    /// Kuruş. Randevunun kendisinde durmuyor, kalemlerin **snapshot**
    /// fiyatlarından toplanıyor: katalog zammı geçmişi bozmasın (Faz 3 kararı).
    let totalMinor: Int
}

/// Onam kabulü (Faz 7).
///
/// Metnin **gövdesi yok**: bir aydınlatma metni 20 bin karaktere kadar
/// çıkabiliyor ve her zaman çizelgesi sayfasına binmemeli. Kanıtın tamamı
/// (gövde, IP, user-agent) ayrı bir uçtan çekiliyor. Ekranda gösterilecek şey
/// **hangi sürümün** kabul edildiği: "kabul etti" tek başına kanıt değil.
nonisolated struct ConsentTimelinePayload: Decodable, Sendable, Equatable {
    let consentKind: String
    /// 0043 öncesi kabullerde `nil` — o satırlar bir sürüme bağlanamadı.
    let version: Int?
    let locale: String?
    let textSha256: String
}

nonisolated struct NoteTimelinePayload: Decodable, Sendable, Equatable {
    let kind: CustomerNoteKind
    let body: String
    let appointmentId: String?
    let authorUserId: String?
    let customerVisible: Bool
}
