package com.klinara.android.services.booking

import com.klinara.android.services.networking.Page

/**
 * Takvim ve randevu uçları. Uç yolları doc yorumlarında; `API_DEVELOPMENT.md` Faz 3.
 *
 * A3.1'de üç okuma metodu var; arayüz A3.3 (yaşam döngüsü) ve A3.4 (oluşturma) ile
 * büyür. Boş imza tahmini kodlanmadı: okunmamış bir ucun imzası her batch'te
 * "refactor" edilir ve bu, ilerleme gibi görünen bir çalkantıdır (A0.5 kararı).
 *
 * **Şube iki yerden gider.** `calendar/day` ve `calendar/week` hem `?branchId=` sorgu parametresi
 * hem `X-Branch-Id` başlığı ister (`@RequireBranchScope`); başlığı `HeaderInterceptor`
 * koyuyor, sorgu parametresi burada. İkisinden biri eksikse 400 `VALIDATION_FAILED`.
 */
interface BookingService {
    /** `GET calendar/day` — tek günün randevuları + yoğunluk kovaları. */
    suspend fun calendarDay(query: CalendarDayQuery): CalendarResponse

    /** `GET calendar/week` — yedi günün randevuları, tek istekte. */
    suspend fun calendarWeek(query: CalendarWeekQuery): CalendarResponse

    /**
     * `GET appointments` — tarih aralığına göre imleçli liste.
     *
     * Takvim ekranı bunu kullanmaz (`calendar/day` daha dar ve yoğunluk da getiriyor);
     * müşteri kartının randevu geçmişi (A4) ve aralık sorguları için var.
     */
    suspend fun appointments(query: AppointmentListQuery): Page<CalendarEntry>

    // --- Yaşam döngüsü (A3.3) ---

    /**
     * `GET appointments/:id`
     *
     * Takvim satırı yetmez: `origin`, `cancellationReason` ve tampon süreleri yalnız
     * burada, üstelik taze bir `version` gerekiyor.
     *
     * **`practitioner` başkasının randevusunda 404 alır, 403 değil** — sunucu bunu
     * bilerek yapıyor (403 kaydın VAR OLDUĞUNU sızdırırdı). Ekran "yetkiniz yok"
     * dememeli, "bulunamadı" demeli.
     */
    suspend fun appointment(id: String): Appointment

    /** `GET appointments/:id/history` — salt okunur denetim izi. */
    suspend fun history(id: String): List<AppointmentHistoryEntry>

    /**
     * `PATCH appointments/:id` — **`If-Match` zorunlu**.
     *
     * Sunucuda düzenlenebilir tek alan not. [notes] `null` gönderilirse not SİLİNİR;
     * ekran bunu kullanıcıya söylemeli.
     */
    suspend fun updateNotes(
        id: String,
        version: Int,
        notes: String?,
    ): Appointment

    /**
     * `POST appointments/:id/cancel` — `If-Match` **istemez**.
     *
     * Yanıt `ETag` başlığı da döndürmüyor ama gövde `version` taşıyor; sürüm oradan
     * alınır ve yeniden `GET` gerekmez.
     */
    suspend fun cancel(
        id: String,
        reason: String?,
    ): Appointment

    /**
     * `POST appointments/:id/status`
     *
     * Aynı duruma geçiş bir hata değil, **200 dönen bir no-op**. Geçersiz geçiş
     * 409 `INVALID_STATUS_TRANSITION`; izin eksikse 403 (`appointment:reopen`).
     */
    suspend fun changeStatus(
        id: String,
        status: AppointmentStatus,
        reason: String? = null,
    ): Appointment

    // --- Oluşturma ve erteleme (A3.4) ---

    /** `GET availability` — verilen hizmet dizisi için uygun başlangıçlar. */
    suspend fun availability(query: AvailabilityQuery): AvailabilityResponse

    /**
     * `POST appointments`
     *
     * [idempotencyKey] **her denemede YENİ** olmalı: düzeltilmiş bir gövdeyi aynı
     * anahtarla göndermek 409 `IDEMPOTENCY_CONFLICT` verir. Anahtar ağ tekrarına karşı,
     * çift dokunuşa karşı değil — onu `isSaving` bayrağı engelliyor.
     *
     * Çakışmada 409 `SLOT_CONFLICT` gelir ve gövde **alternatif saatler** taşır; bu bir
     * hata değil, bir bilgidir.
     */
    suspend fun create(
        input: CreateAppointmentInput,
        idempotencyKey: String,
    ): Appointment

    /** `POST appointments/:id/reschedule` — **`If-Match` zorunlu**. */
    suspend fun reschedule(
        id: String,
        version: Int,
        input: RescheduleAppointmentInput,
    ): Appointment
}
