import Foundation
import Testing
@testable import klinara_ios

/// Faz 4 sözleşmesi — gövdeler gerçek sunucudan **birebir yakalandı**.
///
/// Elle kurulmuş model örnekleri sözleşmeyi test etmez, yalnız kendi
/// varsayımımızı tekrar eder (Ek F).
@Suite("Faz 4 çözümleme")
struct Phase4DecodingTests {

    // MARK: Batch 4.1

    @Test("Etiketli müşteri ve yeni alanlar çözülür")
    func decodesCustomerWithTags() throws {
        let customer = try Fixtures.decode(Customer.self, from: Fixtures.customerWithTags)

        #expect(customer.tags.count == 1)
        #expect(customer.tags.first?.name == "VIP")
        #expect(customer.tags.first?.color == "#c0392b")
        #expect(customer.mergedIntoCustomerId == nil)
        // Adres alanları boş olabilir; `addressSummary` o hâlde nil dönmeli.
        #expect(customer.addressSummary == nil)
    }

    @Test("Adres ve geliş kaynağı çözülür")
    func decodesAddressAndSource() throws {
        let list = try Fixtures.decode(
            ListEnvelope<Customer>.self,
            from: Fixtures.customerList
        ).data
        let ayse = try #require(list.first)

        #expect(ayse.source == .instagram)
        #expect(ayse.city == "İstanbul")
        #expect(ayse.district == "Kadıköy")
        #expect(ayse.postalCode == "34710")
        #expect(ayse.addressSummary?.contains("Kadıköy / İstanbul") == true)
    }

    @Test("Müşteri listesi CURSOR'lu sayfa olarak çözülür")
    func decodesCustomerPage() throws {
        let page = try Fixtures.decode(Page<Customer>.self, from: Fixtures.customerPage)

        #expect(page.data.count == 1)
        #expect(page.pageInfo.hasMore)
        // Cursor opaktır: içeriği çözülmez, aynen geri gönderilir.
        #expect(page.pageInfo.nextCursor?.isEmpty == false)
    }

    /// Arama ucu diğer liste uçlarından ayrılıyor: gövde **çıplak dizi**.
    /// İstemci onu `{ "data": [...] }` sanarsa arama her çağrıda patlar —
    /// bu tam olarak bir kez oldu ve bu test onu sabitliyor.
    @Test("Arama yanıtı ÇIPLAK dizi, zarf değil")
    func decodesSearchAsBareArray() throws {
        let found = try Fixtures.decode([Customer].self, from: Fixtures.customerSearch)
        #expect(found.count == 1)
        #expect(found.first?.fullName == "Ayşe Yılmaz")

        // Zarf olarak çözmeye çalışmak HATA vermeli; sessizce boş liste
        // dönseydi arama "sonuç yok" der ve kimse fark etmezdi.
        #expect(throws: (any Error).self) {
            try Fixtures.decode(ListEnvelope<Customer>.self, from: Fixtures.customerSearch)
        }
    }

    // MARK: Batch 4.2

    @Test("Düzenlenmiş not sürüm 2 taşır")
    func decodesEditedNote() throws {
        let note = try Fixtures.decode(CustomerNote.self, from: Fixtures.customerNote)

        #expect(note.kind == .treatment)
        #expect(note.version == 2)
        #expect(note.wasEdited)
        #expect(note.customerVisible == false)
        #expect(note.appointmentId == nil)
    }

    @Test("Revizyon, düzenlemeden ÖNCEKİ metni taşır")
    func decodesRevisions() throws {
        let revisions = try Fixtures.decode(
            ListEnvelope<CustomerNoteRevision>.self,
            from: Fixtures.noteRevisions
        ).data
        let note = try Fixtures.decode(CustomerNote.self, from: Fixtures.customerNote)

        let first = try #require(revisions.first)
        #expect(first.version == 1)
        // Revizyondaki metin GÜNCEL metin değil; öyle olsaydı geçmiş işe yaramazdı.
        #expect(first.body != note.body)
        #expect(note.body.hasPrefix(first.body))
    }

    @Test("Karma zaman çizelgesi tek akışta çözülür")
    func decodesMixedTimeline() throws {
        let page = try Fixtures.decode(Page<TimelineEntry>.self, from: Fixtures.timelinePage)

        #expect(page.data.count == 2)
        // `occurredAt` azalan sırada: en yeni olay başta.
        #expect(page.data[0].occurredAt > page.data[1].occurredAt)

        guard case .appointment(_, let appointment) = page.data[0] else {
            Issue.record("İlk olay randevu olmalıydı")
            return
        }
        #expect(appointment.status == .scheduled)
        #expect(appointment.totalMinor == 50_000)

        guard case .note(_, let note) = page.data[1] else {
            Issue.record("İkinci olay not olmalıydı")
            return
        }
        #expect(note.kind == .treatment)
    }

    /// Zaman çizelgesindeki randevu `startsAt`i `+00:00` offset'iyle geliyor,
    /// takvim uçlarındaki şube offset'iyle (`+03:00`) değil: payload
    /// `jsonb_build_object` ile kuruluyor. İkisi aynı ANI gösterir; test bunu
    /// sabitliyor ki biçim farkı bir gün "saatler 3 saat kaymış" olarak
    /// keşfedilmesin.
    @Test("Zaman çizelgesinin iki tarih biçimi aynı anı gösterir")
    func timelineDatesAgree() throws {
        let page = try Fixtures.decode(Page<TimelineEntry>.self, from: Fixtures.timelinePage)
        guard case .appointment(let header, let payload) = page.data[0] else {
            Issue.record("İlk olay randevu olmalıydı")
            return
        }
        // `occurredAt` (UTC, `Z`) ile payload `startsAt` (`+00:00`) aynı an.
        #expect(header.occurredAt == payload.startsAt)
        #expect(payload.endsAt > payload.startsAt)
    }

    /// Faz 5, 6 ve 7 zaman çizelgesine kendi kolunu ekleyecek. Bilinmeyen bir
    /// `kind` çözümlemeyi patlatırsa eski istemci yeni sunucuda müşteri kartını
    /// **hiç açamaz** — en pahalı uyumluluk hatası bu.
    @Test("Bilinmeyen olay türü çözümlemeyi PATLATMAZ")
    func decodesUnknownTimelineKind() throws {
        let future = """
        {
          "data": [
            {
              "kind": "payment",
              "id": "9f1c0c3e-0000-4000-8000-000000000001",
              "occurredAt": "2026-08-29T07:00:00.000Z",
              "payload": { "amountMinor": 25000, "method": "card" }
            }
          ],
          "pageInfo": { "hasMore": false, "nextCursor": null }
        }
        """

        let page = try Fixtures.decode(Page<TimelineEntry>.self, from: future)
        guard case .unknown(_, let kind) = page.data[0] else {
            Issue.record("Bilinmeyen tür `unknown` koluna düşmeliydi")
            return
        }
        // Yutulmuyor da: kullanıcı eksik bir geçmişi tam sanmamalı.
        #expect(kind == "payment")
    }

    // MARK: Batch 4.3

    @Test("Presign yanıtı çözülür")
    func decodesPresign() throws {
        let ticket = try Fixtures.decode(
            PresignUploadResponse.self,
            from: Fixtures.presignUpload
        )
        #expect(ticket.contentType == "image/png")
        #expect(ticket.storageKey.contains("/"))
        #expect(ticket.expiresAt > Date(timeIntervalSince1970: 0))
    }

    /// `confirm` anında küçük görsel HENÜZ yok: kuyruk işi sonra koşuyor.
    /// `hasThumbnail` burada `true` gelseydi ızgaradaki yer tutucu yolu hiç
    /// denenmezdi.
    @Test("Yeni dosya kaydında küçük görsel henüz hazır değil")
    func decodesFreshFile() throws {
        let file = try Fixtures.decode(CustomerFile.self, from: Fixtures.customerFile)

        #expect(file.kind == .photo)
        #expect(file.position == .before)
        #expect(file.hasThumbnail == false)
        #expect(file.sha256?.count == 64)
        // Boyut istemcinin beyanından değil, nesnenin kendisinden okunuyor.
        #expect(file.sizeBytes > 0)
    }

    @Test("Yeni grup boş başlar")
    func decodesFileGroup() throws {
        let group = try Fixtures.decode(CustomerFileGroup.self, from: Fixtures.fileGroup)

        #expect(group.title == "Sağ kol — 3. seans")
        #expect(group.bodyArea == "sağ kol")
        #expect(group.files.isEmpty)
        #expect(group.file(at: .before) == nil)
    }
}
