package com.klinara.android.services.crm

import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.PageInfo
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import kotlin.random.Random

/**
 * Not ve zaman çizelgesi mock'u.
 *
 * İki sunucu davranışını **taklit etmek zorunda**, yoksa o yollar yalnız canlıda
 * görülür:
 *
 * 1. **Revizyon trigger'ı** — sürümü yalnız METİN değişimi artırır ve eski gövdeyi
 *    saklar. Mock her düzenlemede sürümü artırsaydı, bayrak değiştiren bir kaydetme
 *    elde tutulan ETag'i gereksiz yere geçersiz kılar ve ekran hiç yaşanmayacak bir
 *    çakışma uyarısı gösterirdi.
 * 2. **İyimser kilit** — bayat sürüm `409`. Mock kabul etseydi, çakışma yolu YALNIZ
 *    canlı sunucuda patlardı.
 *
 * [canReadMedical] SQL'deki daraltmanın karşılığı: izinsiz kullanıcıya klinik notlar
 * **hiç dönmez**.
 */
class MockNotesService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
    var canReadMedical: Boolean = true,
) : NotesService {
    var failing: Boolean = false

    private val notes: MutableList<CustomerNote> = mutableListOf()
    private val revisions: MutableMap<String, MutableList<CustomerNoteRevision>> = mutableMapOf()
    private var idCounter: Int = 0

    init {
        seed()
    }

    override suspend fun notes(customerId: String): List<CustomerNote> {
        settle()
        return notes
            .filter { it.customerId == customerId }
            .filter { visible(it) }
            .sortedByDescending { it.createdAt }
    }

    override suspend fun create(
        customerId: String,
        body: String,
        kind: CustomerNoteKind,
        appointmentId: String?,
        customerVisible: Boolean,
    ): CustomerNote {
        settle()
        assertCanWrite(kind)
        if (body.isBlank()) throw MockErrors.validation("body", "Not boş olamaz")

        idCounter += 1
        val note =
            CustomerNote(
                id = "0e700000-0000-4000-8000-%012d".format(idCounter),
                customerId = customerId,
                appointmentId = appointmentId,
                kind = kind,
                body = body.trim(),
                customerVisible = customerVisible,
                authorUserId = "u-mock",
                version = 1,
                createdAt = SEED_NOW.plusSeconds(idCounter.toLong()),
                updatedAt = SEED_NOW.plusSeconds(idCounter.toLong()),
            )
        notes += note
        return note
    }

    override suspend fun update(
        id: String,
        version: Int,
        body: String?,
        kind: CustomerNoteKind?,
        customerVisible: Boolean?,
    ): CustomerNote {
        settle()

        val index = notes.indexOfFirst { it.id == id }
        if (index < 0 || !visible(notes[index])) throw MockErrors.notFound("Not")
        val current = notes[index]

        // Bayat sürüm: gerçek bir yarış. Sunucu 409 VERSION_CONFLICT veriyor.
        if (current.version != version) throw MockErrors.versionConflict()
        kind?.let { assertCanWrite(it) }

        val newBody = body?.trim() ?: current.body
        // ⚠️ Sürümü YALNIZ metin değişimi artırır — trigger'ın koşulu bu.
        val textChanged = newBody != current.body

        if (textChanged) {
            revisions
                .getOrPut(id) { mutableListOf() }
                .add(
                    CustomerNoteRevision(
                        id = "5e100000-0000-4000-8000-%012d".format(++idCounter),
                        // Revizyon ESKİ gövdeyi taşır, yenisini değil.
                        body = current.body,
                        version = current.version,
                        editedBy = "u-mock",
                        editedAt = SEED_NOW.plusSeconds(idCounter.toLong()),
                    ),
                )
        }

        val updated =
            current.copy(
                body = newBody,
                kind = kind ?: current.kind,
                customerVisible = customerVisible ?: current.customerVisible,
                version = if (textChanged) current.version + 1 else current.version,
                updatedAt = SEED_NOW.plusSeconds(idCounter.toLong()),
            )
        notes[index] = updated
        return updated
    }

    override suspend fun delete(id: String) {
        settle()
        val index = notes.indexOfFirst { it.id == id }
        if (index < 0 || !visible(notes[index])) throw MockErrors.notFound("Not")
        notes.removeAt(index)
    }

    override suspend fun revisions(noteId: String): List<CustomerNoteRevision> {
        settle()
        val note = notes.firstOrNull { it.id == noteId }
        if (note == null || !visible(note)) throw MockErrors.notFound("Not")
        return revisions[noteId].orEmpty().sortedByDescending { it.version }
    }

    override suspend fun timeline(
        customerId: String,
        query: TimelineQuery,
    ): Page<TimelineEntry> {
        settle()

        val entries =
            buildList {
                // Notlar zaman çizelgesinde de görünür — ve klinik daraltma BURADA da
                // geçerli: izinsiz kullanıcı notu listede göremiyorsa çizelgede de
                // görmemeli, yoksa gizlenen metin başka bir kapıdan sızardı.
                notes
                    .filter { it.customerId == customerId && visible(it) }
                    .forEach { note ->
                        add(
                            TimelineEntry(
                                kind = TimelineKind.Note,
                                id = note.id,
                                occurredAt = note.createdAt,
                                payload =
                                    JsonObject(
                                        mapOf(
                                            "kind" to JsonPrimitive(note.kind.wire),
                                            "body" to JsonPrimitive(note.body),
                                        ),
                                    ),
                            ),
                        )
                    }

                addAll(seededTimeline(customerId))
            }
                .filter { query.kinds.isEmpty() || it.kind in query.kinds }
                .sortedWith(compareByDescending<TimelineEntry> { it.occurredAt }.thenByDescending { it.id })

        val limit = (query.limit ?: DEFAULT_LIMIT).coerceIn(1, MAX_LIMIT)
        val start = query.cursor?.toIntOrNull() ?: 0
        val page = entries.drop(start).take(limit)
        val nextIndex = start + page.size
        val hasMore = nextIndex < entries.size

        return Page(
            data = page,
            pageInfo = PageInfo(nextCursor = if (hasMore) nextIndex.toString() else null, hasMore = hasMore),
        )
    }

    /** SQL'deki daraltmanın karşılığı: klinik notlar izinsiz kullanıcıya HİÇ dönmez. */
    private fun visible(note: CustomerNote): Boolean = canReadMedical || !note.kind.isClinical

    private fun assertCanWrite(kind: CustomerNoteKind) {
        if (kind.isClinical && !canReadMedical) {
            throw MockErrors.forbidden("Klinik not yazma yetkiniz yok.")
        }
    }

    /**
     * Tohum — **boş bir kart tasarımı doğrulamaz.**
     *
     * İlk müşteride hem genel hem klinik not var ki izin kapısı elle de sürülebilsin:
     * `customer.medical:read` kapatılınca listenin kısaldığı görülmeli.
     */
    private fun seed() {
        val first = MockCustomers.ALL.first().id
        idCounter += 1
        notes +=
            CustomerNote(
                id = "0e700000-0000-4000-8000-%012d".format(idCounter),
                customerId = first,
                kind = CustomerNoteKind.General,
                body = "Randevu öncesi telefonla teyit edildi.",
                version = 1,
                createdAt = SEED_NOW.minusSeconds(SEED_STEP * GENERAL_NOTE_DAYS_AGO),
                updatedAt = SEED_NOW.minusSeconds(SEED_STEP * GENERAL_NOTE_DAYS_AGO),
            )
        idCounter += 1
        notes +=
            CustomerNote(
                id = "0e700000-0000-4000-8000-%012d".format(idCounter),
                customerId = first,
                kind = CustomerNoteKind.Treatment,
                body = "Cilt reaksiyonu gözlenmedi; doz aynı kalacak.",
                version = 1,
                createdAt = SEED_NOW.minusSeconds(SEED_STEP),
                updatedAt = SEED_NOW.minusSeconds(SEED_STEP),
            )
    }

    /** Randevu ve paket kolları — ve BİLİNMEYEN bir tür. */
    private fun seededTimeline(customerId: String): List<TimelineEntry> {
        if (customerId != MockCustomers.ALL.first().id) return emptyList()
        return listOf(
            TimelineEntry(
                kind = TimelineKind.Appointment,
                id = "a99a0000-0000-4000-8000-000000000001",
                occurredAt = SEED_NOW.minusSeconds(SEED_STEP * APPOINTMENT_DAYS_AGO),
                payload =
                    JsonObject(
                        mapOf(
                            "serviceName" to JsonPrimitive("Cilt bakımı"),
                            "status" to JsonPrimitive("Tamamlandı"),
                            "totalMinor" to JsonPrimitive("90000"),
                        ),
                    ),
            ),
            TimelineEntry(
                kind = TimelineKind.Consent,
                id = "c04e0000-0000-4000-8000-000000000001",
                occurredAt = SEED_NOW.minusSeconds(SEED_STEP * CONSENT_DAYS_AGO),
                payload =
                    JsonObject(
                        mapOf(
                            "consentKind" to JsonPrimitive("Aydınlatma metni"),
                            "version" to JsonPrimitive("3"),
                        ),
                    ),
            ),
            // Sunucunun YARIN ekleyeceği bir tür. İstemci bunu çizebilmeli, çökmemeli
            // ve sessizce atlamamalı.
            TimelineEntry(
                kind = TimelineKind.Unknown,
                id = "f0000000-0000-4000-8000-000000000001",
                occurredAt = SEED_NOW.minusSeconds(SEED_STEP * UNKNOWN_DAYS_AGO),
                payload = JsonObject(mapOf("kind" to JsonPrimitive("loyalty_award"))),
            ),
        )
    }

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    private companion object {
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
        const val DEFAULT_LIMIT = 50
        const val MAX_LIMIT = 200
        const val SEED_STEP = 86_400L
        const val GENERAL_NOTE_DAYS_AGO = 2L
        const val APPOINTMENT_DAYS_AGO = 4L
        const val CONSENT_DAYS_AGO = 5L
        const val UNKNOWN_DAYS_AGO = 6L
        val SEED_NOW: Instant = Instant.parse("2026-09-08T09:00:00Z")
    }
}
