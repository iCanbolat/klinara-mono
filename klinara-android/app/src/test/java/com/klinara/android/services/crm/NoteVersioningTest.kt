package com.klinara.android.services.crm

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * İyimser kilit ve revizyon trigger'ı.
 *
 * Mock bunları taklit etmezse çakışma yolu YALNIZ canlı sunucuda patlar — geliştirici
 * o akışı çalışıyor sanarak ilerler.
 */
class NoteVersioningTest {
    private val customer = MockCustomers.ALL.first().id

    private fun subject(canReadMedical: Boolean = true) =
        MockNotesService(latencyEnabled = false, canReadMedical = canReadMedical)

    @Test
    @DisplayName("METİN değişimi sürümü artırır ve ESKİ gövdeyi revizyona yazar")
    fun textChangeBumpsVersionAndKeepsHistory() =
        runTest {
            val service = subject()
            val note = service.create(customer, "İlk hâli")

            val updated = service.update(note.id, note.version, body = "İkinci hâli")

            assertEquals(2, updated.version)
            val revisions = service.revisions(note.id)
            assertEquals(1, revisions.size)
            // Revizyon ESKİ metni taşır.
            assertEquals("İlk hâli", revisions.first().body)
        }

    @Test
    @DisplayName("BAYRAK değişimi sürümü ARTIRMAZ — elde tutulan ETag geçerli kalır")
    fun flagChangeLeavesTheVersionAlone() =
        runTest {
            val service = subject()
            val note = service.create(customer, "Metin", CustomerNoteKind.General)

            val updated = service.update(note.id, note.version, customerVisible = true)

            // Trigger'ın koşulu `new.body is distinct from old.body`. Mock her
            // düzenlemede artırsaydı, bayrak değiştiren bir kaydetme elde tutulan
            // ETag'i gereksiz yere geçersiz kılar ve hiç yaşanmayacak bir çakışma
            // uyarısı gösterilirdi.
            assertEquals(note.version, updated.version)
            assertTrue(updated.customerVisible)
            assertTrue(service.revisions(note.id).isEmpty())
        }

    @Test
    @DisplayName("BAYAT sürüm 409 VERSION_CONFLICT verir")
    fun staleVersionConflicts() =
        runTest {
            val service = subject()
            val note = service.create(customer, "İlk")
            service.update(note.id, note.version, body = "İkinci")

            // İlk açılıştaki sürümle tekrar kaydetmeye çalışmak = başkasının yazdığının
            // üstüne yazmak. Sunucu buna izin vermiyor.
            val error = runCatching { service.update(note.id, note.version, body = "Üçüncü") }.exceptionOrNull()

            assertTrue(error is ApiError.Problem)
            assertEquals(ApiErrorCode.VERSION_CONFLICT, (error as ApiError.Problem).code)
        }

    @Test
    @DisplayName("Aynı metni tekrar kaydetmek revizyon BIRAKMAZ")
    fun rewritingTheSameTextLeavesNoRevision() =
        runTest {
            val service = subject()
            val note = service.create(customer, "Aynı metin")

            val updated = service.update(note.id, note.version, body = "Aynı metin")

            assertEquals(note.version, updated.version)
            assertTrue(service.revisions(note.id).isEmpty())
        }

    @Test
    @DisplayName("Klinik notlar izinsiz kullanıcıya HİÇ dönmez")
    fun clinicalNotesAreInvisibleWithoutPermission() =
        runTest {
            val withMedical = subject(canReadMedical = true)
            val all = withMedical.notes(customer)
            assertTrue(all.any { it.kind.isClinical })

            val withoutMedical = subject(canReadMedical = false)
            val visible = withoutMedical.notes(customer)

            // Sunucu bunları SORGUDAN eliyor ve "gizlendi" bayrağı yok; ekran bu
            // sessizliği açık bir metinle kırmak zorunda.
            assertTrue(visible.none { it.kind.isClinical })
            assertTrue(visible.size < all.size)
        }

    @Test
    @DisplayName("Klinik not izinsiz kullanıcıya 404 verir — 403 DEĞİL")
    fun clinicalNoteIsNotFoundNotForbidden() =
        runTest {
            val clinical = subject().notes(customer).first { it.kind.isClinical }
            val restricted = subject(canReadMedical = false)

            val error = runCatching { restricted.update(clinical.id, 1, body = "x") }.exceptionOrNull()

            // `403` "var ama göremezsin" derdi ve notun VARLIĞINI sızdırırdı.
            assertTrue(error is ApiError.Problem)
            assertEquals(ApiErrorCode.NOT_FOUND, (error as ApiError.Problem).code)
        }

    @Test
    @DisplayName("İzinsiz kullanıcı klinik not YAZAMAZ")
    fun writingClinicalNotesRequiresPermission() =
        runTest {
            val restricted = subject(canReadMedical = false)

            val error =
                runCatching { restricted.create(customer, "Gizli", CustomerNoteKind.Treatment) }.exceptionOrNull()

            assertTrue(error is ApiError.Problem)
        }

    @Test
    @DisplayName("Zaman çizelgesinde de klinik daraltma geçerli — başka kapıdan sızmaz")
    fun timelineRespectsMedicalNarrowing() =
        runTest {
            val restricted = subject(canReadMedical = false)

            val entries = restricted.timeline(customer).data
            val noteBodies = entries.filter { it.kind == TimelineKind.Note }.mapNotNull { it.string("kind") }

            // Not listesinde gizlenen metnin çizelgede görünmesi, izni bir kapıda
            // uygulayıp diğerinde unutmak olurdu.
            assertTrue(noteBodies.none { CustomerNoteKind.from(it).isClinical })
        }

    @Test
    @DisplayName("Zaman çizelgesi tür filtresi daraltıyor; boş küme HEPSİ demek")
    fun timelineFilterNarrows() =
        runTest {
            val service = subject()

            val all = service.timeline(customer, TimelineQuery()).data
            val onlyNotes = service.timeline(customer, TimelineQuery(kinds = setOf(TimelineKind.Note))).data

            assertTrue(all.size > onlyNotes.size)
            assertTrue(onlyNotes.all { it.kind == TimelineKind.Note })
            // Boş küme "hiçbiri" DEĞİL "belirtilmedi": filtreyi temizlemenin sonucu
            // boş bir liste olsaydı kullanıcı geçmişini kaybederdi.
            assertFalse(all.isEmpty())
        }

    @Test
    @DisplayName("Çizelge BİLİNMEYEN türü de taşır — mock ileri sürümlü")
    fun timelineCarriesAnUnknownKind() =
        runTest {
            val entries = subject().timeline(customer).data

            assertTrue(entries.any { it.kind == TimelineKind.Unknown })
        }
}
