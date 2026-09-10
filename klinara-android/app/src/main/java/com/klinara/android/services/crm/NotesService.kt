package com.klinara.android.services.crm

import com.klinara.android.services.networking.Page

/**
 * Not ve zaman çizelgesi uçları.
 *
 * **Klinik notlar SQL'de daraltılıyor**, uygulamada değil: `treatment` ve `internal`
 * notlar `customer.medical:read` izni olmayana sorgudan **hiç dönmüyor** ve detayda
 * `404` geliyor, `403` değil. İstemci bu sessizliği kırmak zorunda — bkz.
 * `CustomerNoteKind`.
 */
interface NotesService {
    /** `GET customers/:id/notes` — zarflı. */
    suspend fun notes(customerId: String): List<CustomerNote>

    /** `POST customers/:id/notes` — `customer:write`; klinik tür `customer.medical:write`. */
    suspend fun create(
        customerId: String,
        body: String,
        kind: CustomerNoteKind = CustomerNoteKind.General,
        appointmentId: String? = null,
        customerVisible: Boolean = false,
    ): CustomerNote

    /**
     * `PATCH notes/:id` — **`If-Match` ZORUNLU**.
     *
     * [version] notun **AÇILDIĞI ANDAKİ** sürüm olmalıdır, store'daki güncel sürüm
     * değil: güncel sürümü göndermek, başkasının bu arada yazdığı metnin üstüne
     * sessizce yazmak ve kilidi etkisiz kılmak demektir.
     *
     * Başlıksız istek `428`, bayat sürüm `409 VERSION_CONFLICT`.
     */
    suspend fun update(
        id: String,
        version: Int,
        body: String? = null,
        kind: CustomerNoteKind? = null,
        customerVisible: Boolean? = null,
    ): CustomerNote

    /** `DELETE notes/:id` — `If-Match` İSTEMEZ (arşivleme geri alınabilir bir soft delete). */
    suspend fun delete(id: String)

    /** `GET notes/:id/revisions` — gövdeler düzenlemeden ÖNCEKİ metni taşır. */
    suspend fun revisions(noteId: String): List<CustomerNoteRevision>

    /** `GET customers/:id/timeline` — imleçli. */
    suspend fun timeline(
        customerId: String,
        query: TimelineQuery = TimelineQuery(),
    ): Page<TimelineEntry>
}
