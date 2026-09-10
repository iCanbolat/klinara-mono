package com.klinara.android.services.crm

import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.Page
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

class NoteModelsTest {
    private fun <T> decode(
        path: String,
        deserializer: kotlinx.serialization.DeserializationStrategy<T>,
    ): T = KlinaraJson.decodeFromString(deserializer, Fixtures.read(path))

    @Test
    @DisplayName("Not çözülüyor; sürüm 1'den büyükse düzenlenmiş sayılıyor")
    fun noteDecodes() {
        val note = decode("crm/customer-note.json", CustomerNote.serializer())

        assertEquals(CustomerNoteKind.Treatment, note.kind)
        assertTrue(note.kind.isClinical)
        assertEquals(3, note.version)
        assertTrue(note.wasEdited)
        assertFalse(note.customerVisible)
    }

    @Test
    @DisplayName("Revizyon gövdesi düzenlemeden ÖNCEKİ metni taşır")
    fun revisionsCarryTheOldBody() {
        val revisions =
            decode(
                "crm/note-revisions.json",
                ListEnvelope.serializer(CustomerNoteRevision.serializer()),
            ).data

        assertEquals(2, revisions.size)
        // Sürüm 2'nin revizyonu, sürüm 2 kaydedilmeden ÖNCEKİ metni taşır. Ekranda
        // "şu an" ile "önce" karışırsa kullanıcı yanlış metni geri alır.
        assertEquals("Cilt reaksiyonu hafif; doz düşürülecek.", revisions.first().body)
        assertEquals(2, revisions.first().version)
    }

    @Test
    @DisplayName("Karma zaman çizelgesi çözülüyor — dört ayrı kol")
    fun mixedTimelineDecodes() {
        val page = decode("crm/timeline-page.json", Page.serializer(TimelineEntry.serializer()))

        assertEquals(4, page.data.size)
        assertEquals(
            listOf(
                TimelineKind.Appointment,
                TimelineKind.Note,
                TimelineKind.Consent,
                TimelineKind.PackageLedger,
            ),
            page.data.map { it.kind },
        )
        assertTrue(page.pageInfo.hasMore)
    }

    @Test
    @DisplayName("BİLİNMEYEN `kind` çözümlemeyi düşürmez ve YUTULMAZ")
    fun unknownKindIsRenderedNotDropped() {
        val page =
            decode("crm/timeline-unknown-kind.json", Page.serializer(TimelineEntry.serializer()))

        // Tek bir yeni olay türü, eski istemcide müşteri kartını HİÇ açılamaz hâle
        // getirirdi. Bu testin varlık sebebi tam olarak bu.
        assertEquals(2, page.data.size)
        assertEquals(TimelineKind.Unknown, page.data.first().kind)
        // Sessizce atlanmıyor da: ekranda görünecek bir başlığı var.
        assertEquals("Bu sürümde gösterilemeyen kayıt", page.data.first().title)
    }

    @Test
    @DisplayName("Zaman çizelgesi `+00:00` taşır; takvimin `+03:00`'ıyla AYNI anı gösterir")
    fun bothOffsetFormatsResolveToTheSameInstant() {
        val page = decode("crm/timeline-page.json", Page.serializer(TimelineEntry.serializer()))

        // Takvim uçları şube offset'iyle (`+03:00`), zaman çizelgesi UTC ile geliyor.
        // İkisi aynı anı gösteriyor; varsayım yanlış olsaydı bir gün "saatler 3 saat
        // kaymış" olarak keşfedilirdi (iOS'ta yakalanan hata).
        assertEquals(Instant.parse("2026-09-07T06:00:00Z"), page.data.first().occurredAt)
    }

    @Test
    @DisplayName("Payload'dan alan okuma eksik anahtarda ÇÖKMEZ")
    fun payloadAccessIsForgiving() {
        val page = decode("crm/timeline-page.json", Page.serializer(TimelineEntry.serializer()))
        val appointment = page.data.first()

        assertEquals("Cilt bakımı", appointment.string("serviceName"))
        assertEquals(90_000L, appointment.long("totalMinor"))
        // Olmayan alan null döner — Faz 5/6 kendi alanlarını eklerken buraya
        // dokunmadan ekleyebilmeli.
        assertEquals(null, appointment.string("yokBoyleBirAlan"))
    }

    @Test
    @DisplayName("Onam kolu METİN GÖVDESİ taşımaz — sürüm kanıtın kendisidir")
    fun consentCarriesNoBody() {
        val page = decode("crm/timeline-page.json", Page.serializer(TimelineEntry.serializer()))
        val consent = page.data.first { it.kind == TimelineKind.Consent }

        // 20k'lık bir aydınlatma metni her sayfaya binerdi.
        assertEquals(null, consent.string("body"))
        assertNotNull(consent.string("textSha256"))
        assertEquals("Sürüm 3", consent.subtitle)
    }

    @Test
    @DisplayName("`Unknown` seçilebilir listede YOK — kurtarma dalı, seçenek değil")
    fun unknownIsNotSelectable() {
        assertFalse(TimelineKind.Unknown in TimelineKind.selectable)
        assertFalse(CustomerNoteKind.Unknown in CustomerNoteKind.selectable)
        assertEquals(CustomerNoteKind.Unknown, CustomerNoteKind.from("gelecekteki_tur"))
    }
}
