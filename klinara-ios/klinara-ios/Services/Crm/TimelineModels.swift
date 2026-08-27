import Foundation

/// Müşteri zaman çizelgesi — `GET /customers/:id/timeline`.
///
/// Sunucu randevu ve notları `union all` ile TEK sorguda, tek sıralamada
/// birleştiriyor; sözleşme her kolun `kind` + `payload` döndürmesi. Faz 5
/// (paket), Faz 6 (tahsilat) ve Faz 7 (onam) buraya kendi kolunu ekleyecek.

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
    case unknown(TimelineHeader, kind: String)

    var header: TimelineHeader {
        switch self {
        case .appointment(let header, _), .note(let header, _), .unknown(let header, _):
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

nonisolated struct NoteTimelinePayload: Decodable, Sendable, Equatable {
    let kind: CustomerNoteKind
    let body: String
    let appointmentId: String?
    let authorUserId: String?
    let customerVisible: Bool
}
