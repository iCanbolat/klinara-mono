package com.klinara.android.services.booking

import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.mock.MockClock
import com.klinara.android.services.mock.MockDataScenario
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.networking.SlotConflict
import com.klinara.android.services.scheduling.MockSchedulingService
import com.klinara.android.services.staff.MockStaffService
import com.klinara.android.services.staff.StaffProfile
import com.klinara.android.services.networking.SlotSuggestion
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.ProblemDetails
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.PageInfo
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.random.Random

/**
 * Mock takvim servisi.
 *
 * Sunucusuz sürülebilen bir takvim; [MockDataScenario]'nun ilk gerçek tüketicisi.
 * Senaryo `var` çünkü geliştirici menüsü onu çalışma zamanında değiştiriyor —
 * `MockAuthService.scenario` ile aynı kalıp.
 *
 * **Sunucunun iki kuralı burada da geçerli**, yoksa mock'ta doğru görünen bir ekran
 * canlıda bozulur:
 * 1. Gün/hafta yanıtı yalnız o aralığın randevularını taşır.
 * 2. Yoğunluk iptal/gelmedi'yi saymaz ve personel filtresine göre DARALMAZ.
 */
class MockBookingService(
    var scenario: MockDataScenario = MockDataScenario.BusyDay,
    private val clock: BranchClock = BranchClock("Europe/Istanbul"),
    private val mockClock: MockClock = MockClock(clock),
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
    /**
     * Katalog tablosu (A7.1). Varsayılan tohum; `ServiceContainer.mock()` canlı mock
     * kataloğu bağlar ki pasife alınan hizmet rezervasyondan düşsün, yenisi görünsün.
     */
    private val catalog: () -> List<ClinicService> = { MockCatalogService.ALL },
    /** Personel tablosu (A7.2) — pasif personel ve kaldırılan yetkinlik slot adayından düşer. */
    private val staff: () -> List<StaffProfile> = { MockStaffService.ALL },
    /**
     * Çalışma saatleri (A7.3). Bağlıysa slotlar şube saatleri ∩ personel programı − mola −
     * istisnalar içinde üretilir (sunucunun kuralı); `null` ise (birim testleri) eski sabit
     * 09:00–18:00 penceresi — tohumlu testler haftanın gününe bağımlı olmasın diye.
     */
    private val scheduling: MockSchedulingService? = null,
) : BookingService {
    /** Ağ hatası senaryosunda takvim de düşsün diye. */
    var failing: Boolean = false

    /**
     * Oturum içi değişiklikler. Kalıcı çünkü aksi hâlde bir durum değişikliği bir
     * sonraki yenilemede tohumdan geri gelir ve ekranın davranışı hiç sürülemez
     * (`MockAuthService`'in silinen passkey'lerde verdiği kararın aynısı).
     */
    private val edits = mutableMapOf<String, Appointment>()
    private val trails = mutableMapOf<String, MutableList<AppointmentHistoryEntry>>()

    /** Oturum içinde OLUŞTURULAN randevular — tohumda yoklar, listede görünmeliler. */
    private val extras = mutableListOf<Appointment>()

    /**
     * Paket defterine bağlantı (A5.2).
     *
     * Sunucuda tamamlanma geçişi ile paketten seans düşme AYNI transaction: hak yetersizse
     * durum değişikliği de reddedilir. Mock bunu bir kanca ile kuruyor — booking → packages
     * doğrudan bağımlılığı iki mock'u birbirine kilitlerdi (paketler de bağlama için
     * booking'e bakıyor). Kanca `ServiceContainer.mock()`'ta bağlanır; bağlanmamışsa
     * (testler) tamamlanma paketsiz davranır.
     */
    interface PackageConsumptionHook {
        /** Tamamlanmadan HEMEN ÖNCE; fırlatırsa geçiş olmaz. */
        fun onCompleted(appointment: Appointment)

        /** Tamamlanmış randevu yeniden açılınca — defter ters kayıt alır. */
        fun onReopened(appointment: Appointment)
    }

    var packageHook: PackageConsumptionHook? = null

    /**
     * Randevu satırını bir paket kalemine bağlar ve randevunun GÜNCEL durumunu döner —
     * paket mock'u "şimdi düşmeli mi" kararını buna göre verir.
     */
    internal fun bindPackageItem(
        appointmentId: String,
        appointmentServiceId: String,
        customerPackageItemId: String,
    ): Appointment {
        val existing = current(appointmentId)
        if (existing.services.none { it.id == appointmentServiceId }) {
            throw ApiError.Problem(
                ProblemDetails(
                    code = ApiErrorCode.NOT_FOUND,
                    title = "Randevu kalemi bulunamadı",
                    status = HTTP_NOT_FOUND,
                ),
            )
        }
        val updated =
            existing.copy(
                services =
                    existing.services.map { line ->
                        if (line.id != appointmentServiceId) return@map line
                        line.copy(customerPackageItemId = customerPackageItemId)
                    },
                version = existing.version + 1,
            )
        edits[appointmentId] = updated
        return updated
    }

    /** Geliştirici menüsü senaryoyu değiştirince oturum içi değişiklikler de düşer. */
    fun reset() {
        edits.clear()
        trails.clear()
        extras.clear()
    }

    override suspend fun appointment(id: String): Appointment {
        simulateLatency()
        failure()?.let { throw it }
        return current(id)
    }

    override suspend fun history(id: String): List<AppointmentHistoryEntry> {
        simulateLatency()
        failure()?.let { throw it }
        val appointment = current(id)
        val created =
            AppointmentHistoryEntry(
                id = "${'$'}{appointment.id}-created",
                action = AppointmentHistoryAction.Created,
                actorUserId = MockIds.USER_MANAGER,
                createdAt = appointment.createdAt,
            )
        return listOf(created) + trails[id].orEmpty()
    }

    override suspend fun updateNotes(
        id: String,
        version: Int,
        notes: String?,
    ): Appointment {
        simulateLatency()
        failure()?.let { throw it }
        val existing = current(id)
        assertVersion(existing, version)
        return commit(existing.copy(notes = notes), AppointmentHistoryAction.Updated, reason = null)
    }

    override suspend fun cancel(
        id: String,
        reason: String?,
    ): Appointment {
        simulateLatency()
        failure()?.let { throw it }
        val existing = current(id)
        if (existing.status == AppointmentStatus.Cancelled) return existing
        return commit(
            existing.copy(status = AppointmentStatus.Cancelled, cancellationReason = reason),
            AppointmentHistoryAction.Cancelled,
            reason = reason,
            fromStatus = existing.status,
            toStatus = AppointmentStatus.Cancelled,
        )
    }

    override suspend fun changeStatus(
        id: String,
        status: AppointmentStatus,
        reason: String?,
    ): Appointment {
        simulateLatency()
        failure()?.let { throw it }
        val existing = current(id)
        // Aynı duruma geçiş bir HATA DEĞİL, 200 dönen bir no-op — sunucudaki davranış.
        if (existing.status == status) return existing
        if (status !in existing.status.allowedTransitions(canReopen = true)) {
            throw ApiError.Problem(
                ProblemDetails(
                    code = ApiErrorCode.CONFLICT,
                    title = "Geçersiz durum geçişi",
                    detail = "Geçersiz durum geçişi: ${'$'}{existing.status.wire} → ${'$'}{status.wire}",
                    status = HTTP_CONFLICT,
                ),
            )
        }
        // Defter önce: hak yetersizse (`PACKAGE_EXHAUSTED`) durum da değişmemeli.
        when {
            status == AppointmentStatus.Completed -> packageHook?.onCompleted(existing)
            existing.status == AppointmentStatus.Completed -> packageHook?.onReopened(existing)
            else -> Unit
        }
        return commit(
            existing.copy(status = status),
            AppointmentHistoryAction.StatusChanged,
            reason = reason,
            fromStatus = existing.status,
            toStatus = status,
        )
    }

    override suspend fun availability(query: AvailabilityQuery): AvailabilityResponse {
        simulateLatency()
        failure()?.let { throw it }

        val totalMinutes =
            query.serviceIds.sumOf { serviceId ->
                catalog().firstOrNull { it.id == serviceId }?.durationMinutes ?: DEFAULT_SLOT_MINUTES
            }
        // Aday personel YETKİNLİĞE göre süzülür: sunucunun uygunluk motoru da öyle
        // yapıyor. Süzmezsek mock "3 kişi uygun" der, kullanıcı o slotu seçer ve canlı
        // sunucu 422 RESOURCE_UNAVAILABLE ile reddeder — mock'ta doğru görünüp canlıda
        // bozulan tam olarak bu sınıftan bir hata.
        val candidates =
            staff()
                .filter { profile -> profile.isActive }
                .filter { profile -> query.serviceIds.all { profile.isCompetent(it, query.branchId) } }
                .map { it.id }
                .filter { query.staffProfileId == null || it == query.staffProfileId }

        // Slotlar 15 dakikalık ızgarada, çalışma saatleri içinde ve DOLU aralıklar
        // çıkarılarak üretiliyor. Boş bir motor (her saat uygun) çakışma akışını
        // sürülemez yapardı — asıl sınanacak şey o.
        val busy = visible(query.from, query.to, staffProfileId = null).filterNot { it.status.isTerminal }
        val day = clock.startOfDay(query.from)
        val windows = candidates.associateWith { staffId -> workingWindows(staffId, query.branchId, day) }
        val slots = mutableListOf<AvailabilitySlot>()
        var cursor = day
        val dayEnd = clock.adding(1L, day)

        while (cursor < dayEnd && cursor < query.to) {
            val end = clock.addingMinutes(totalMinutes.toLong(), cursor)
            val at = cursor
            val free =
                candidates.filter { staffId ->
                    windows.getValue(staffId).any { at >= it.start && end <= it.endInclusive } &&
                        busy.none { it.overlaps(at, end) && staffId in it.staffProfileIds }
                }
            if (cursor >= query.from && free.isNotEmpty()) {
                slots += AvailabilitySlot(startsAt = cursor, endsAt = end, staffProfileIds = free)
            }
            cursor = clock.addingMinutes(SLOT_GRANULARITY_MINUTES.toLong(), cursor)
        }

        return AvailabilityResponse(
            branchId = query.branchId,
            timezone = clock.zone.id,
            slotGranularityMinutes = SLOT_GRANULARITY_MINUTES,
            slots = slots,
        )
    }

    override suspend fun create(
        input: CreateAppointmentInput,
        idempotencyKey: String,
    ): Appointment {
        simulateLatency()
        failure()?.let { throw it }

        val startsAt =
            OffsetDateTime.parse(input.startsAt, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant()
        val minutes =
            input.services.sumOf { line ->
                catalog().firstOrNull { it.id == line.serviceId }?.durationMinutes
                    ?: DEFAULT_SLOT_MINUTES
            }
        val endsAt = clock.addingMinutes(minutes.toLong(), startsAt)

        conflict(startsAt, endsAt, input.services.map { it.staffProfileId })?.let { throw it }

        val created = build(input, startsAt, endsAt)
        edits[created.id] = created
        extras += created
        return created
    }

    override suspend fun reschedule(
        id: String,
        version: Int,
        input: RescheduleAppointmentInput,
    ): Appointment {
        simulateLatency()
        failure()?.let { throw it }

        val existing = current(id)
        assertVersion(existing, version)
        if (!existing.status.canReschedule) {
            throw ApiError.Problem(
                ProblemDetails(
                    code = ApiErrorCode.CONFLICT,
                    title = "Bu randevu ertelenemez",
                    detail = "Kapanmış bir randevunun saati değiştirilemez.",
                    status = HTTP_CONFLICT,
                ),
            )
        }

        val startsAt =
            OffsetDateTime.parse(input.startsAt, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant()
        val shift = clock.minutes(existing.startsAt, startsAt).toLong()
        val moved =
            existing.copy(
                startsAt = startsAt,
                endsAt = clock.addingMinutes(shift, existing.endsAt),
                services =
                    existing.services.map {
                        it.copy(
                            startsAt = clock.addingMinutes(shift, it.startsAt),
                            endsAt = clock.addingMinutes(shift, it.endsAt),
                        )
                    },
            )
        conflict(moved.startsAt, moved.endsAt, moved.services.map { it.staffProfileId }, excluding = id)
            ?.let { throw it }

        return commit(
            moved,
            AppointmentHistoryAction.Rescheduled,
            reason = input.reason,
        ).copy().also { updated ->
            trails[id]?.lastOrNull()?.let { last ->
                trails[id]!![trails[id]!!.lastIndex] =
                    last.copy(oldStartsAt = existing.startsAt, newStartsAt = updated.startsAt)
            }
        }
    }

    /**
     * Çakışma varsa 409 `SLOT_CONFLICT` — **alternatif saatlerle birlikte**.
     *
     * Sunucu `conflicts` ve `suggestions` alanlarını problem belgesinin KÖKÜNE koyuyor
     * ve `conflicts` `resourceId`/`from`/`to` kullanıyor (`startsAt`/`endsAt` değil).
     * Mock'un aynı şekli üretmesi, çakışma sayfasının gerçekten sürülebilmesinin tek yolu.
     */
    private fun conflict(
        startsAt: Instant,
        endsAt: Instant,
        staffIds: List<String>,
        excluding: String? = null,
    ): ApiError? {
        val clashes =
            visible(startsAt, endsAt, staffProfileId = null)
                .filterNot { it.status.isTerminal }
                .filter { it.id != excluding }
                .filter { entry -> entry.staffProfileIds.any { it in staffIds } }
        if (clashes.isEmpty()) return null

        val suggestions =
            (1..SUGGESTION_LIMIT).map { step ->
                val start = clock.addingMinutes((step * SUGGESTION_STEP_MINUTES).toLong(), endsAt)
                SlotSuggestion(
                    startsAt = start,
                    endsAt = clock.addingMinutes(clock.minutes(startsAt, endsAt).toLong(), start),
                    staffProfileIds = staffIds.distinct(),
                )
            }

        return ApiError.Problem(
            ProblemDetails(
                code = ApiErrorCode.SLOT_CONFLICT,
                title = "Seçilen saat dolu",
                detail = "Kaynak bu aralıkta başka bir kayıt tarafından tutuluyor.",
                status = HTTP_CONFLICT,
                conflicts =
                    clashes.map { entry ->
                        SlotConflict(
                            resourceType = "staff",
                            resourceId = entry.staffProfileIds.first(),
                            appointmentId = entry.id,
                            from = entry.startsAt,
                            to = entry.endsAt,
                        )
                    },
                suggestions = suggestions,
            ),
        )
    }

    private fun build(
        input: CreateAppointmentInput,
        startsAt: Instant,
        endsAt: Instant,
    ): Appointment {
        val id = "a99a0000-0000-4000-8000-%012d".format(NEW_ID_BASE + extras.size)
        var cursor = startsAt
        val lines =
            input.services.mapIndexed { order, line ->
                val service = catalog().firstOrNull { it.id == line.serviceId }
                val minutes = service?.durationMinutes ?: DEFAULT_SLOT_MINUTES
                val lineStart = cursor
                cursor = clock.addingMinutes(minutes.toLong(), cursor)
                AppointmentServiceLine(
                    id = "$id-$order",
                    serviceId = line.serviceId,
                    staffProfileId = line.staffProfileId,
                    sortOrder = order,
                    startsAt = lineStart,
                    endsAt = cursor,
                    durationMinutes = minutes,
                    bufferBeforeMinutes = service?.bufferBeforeMinutes ?: 0,
                    bufferAfterMinutes = service?.bufferAfterMinutes ?: 0,
                    priceMinor = service?.priceMinor ?: 0,
                    vatRateBasisPoints = service?.vatRateBasisPoints ?: 0,
                    customerPackageItemId = line.customerPackageItemId,
                )
            }
        return Appointment(
            id = id,
            tenantId = MockIds.TENANT_NISANTASI,
            branchId = input.branchId,
            customerId = input.customerId,
            status = AppointmentStatus.Scheduled,
            startsAt = startsAt,
            endsAt = endsAt,
            notes = input.notes,
            version = 1,
            totalMinor = lines.sumOf { it.priceMinor },
            createdAt = mockClock.next(),
            services = lines,
        )
    }

    /** Tohum + oturum içi değişiklik. `internal`: paket mock'u bağlamadan önce randevuyu okuyor. */
    internal fun current(id: String): Appointment =
        edits[id]
            ?: MockBookingSeed
                .entries(scenario, clock, mockClock.reference)
                .firstOrNull { it.id == id }
                ?.let { MockBookingSeed.detail(it, clock) }
            ?: throw ApiError.Problem(
                ProblemDetails(
                    code = ApiErrorCode.NOT_FOUND,
                    title = "Randevu bulunamadı",
                    status = HTTP_NOT_FOUND,
                ),
            )

    /**
     * `If-Match` bayatsa 409.
     *
     * Mock'ta da uygulanıyor: iyimser kilit, ekranın sürümü nereden aldığını sınayan tek
     * mekanizma. `cancel`/`status` `ETag` DÖNDÜRMEDİĞİ için ekran sürümü gövdeden almak
     * zorunda; almazsa bir sonraki not kaydı **kendi değişikliği yüzünden** 409 alır ve
     * bu ancak canlıda fark edilirdi.
     */
    private fun assertVersion(
        existing: Appointment,
        version: Int,
    ) {
        if (existing.version == version) return
        throw ApiError.Problem(
            ProblemDetails(
                code = ApiErrorCode.VERSION_CONFLICT,
                title = "Kayıt siz okuduktan sonra değişti",
                detail = "Kaydı yeniden okuyup değişikliği tekrar uygulayın.",
                status = HTTP_CONFLICT,
            ),
        )
    }

    private fun commit(
        updated: Appointment,
        action: AppointmentHistoryAction,
        reason: String?,
        fromStatus: AppointmentStatus? = null,
        toStatus: AppointmentStatus? = null,
    ): Appointment {
        val bumped = updated.copy(version = updated.version + 1)
        edits[bumped.id] = bumped
        trails
            .getOrPut(bumped.id) { mutableListOf() }
            .add(
                AppointmentHistoryEntry(
                    id = "${'$'}{bumped.id}-${'$'}{bumped.version}",
                    action = action,
                    actorUserId = MockIds.USER_MANAGER,
                    fromStatus = fromStatus,
                    toStatus = toStatus,
                    reason = reason,
                    createdAt = mockClock.next(),
                ),
            )
        return bumped
    }

    override suspend fun calendarDay(query: CalendarDayQuery): CalendarResponse {
        simulateLatency()
        failure()?.let { throw it }

        val day = clock.date(query.date) ?: throw ApiError.MalformedResponse("Geçersiz tarih: ${query.date}")
        val from = clock.startOfDay(day)
        val to = clock.adding(1, from)
        return response(query.branchId, from, to, query.staffProfileId)
    }

    override suspend fun calendarWeek(query: CalendarWeekQuery): CalendarResponse {
        simulateLatency()
        failure()?.let { throw it }

        val start =
            clock.date(query.weekStart)
                ?: throw ApiError.MalformedResponse("Geçersiz tarih: ${query.weekStart}")
        val from = clock.startOfWeek(start)
        val to = clock.adding(DAYS_PER_WEEK, from)
        return response(query.branchId, from, to, query.staffProfileId)
    }

    override suspend fun appointments(query: AppointmentListQuery): Page<CalendarEntry> {
        simulateLatency()
        failure()?.let { throw it }

        val matching =
            visible(query.from, query.to, query.staffProfileId)
                .filter { query.statuses.isEmpty() || it.status in query.statuses }
                .filter { query.customerId == null || it.customerId == query.customerId }
        // Mock sayfalamıyor: tek sayfada dönüyor ve `hasMore = false` diyor. Sahte bir
        // imleç üretmek, imleç MANTIĞINI değil imleç KURGUSUNU test etmek olurdu.
        return Page(data = matching, pageInfo = PageInfo(nextCursor = null, hasMore = false))
    }

    private fun response(
        branchId: String,
        from: Instant,
        to: Instant,
        staffProfileId: String?,
    ): CalendarResponse {
        val entries = visible(from, to, staffProfileId)
        return CalendarResponse(
            branchId = branchId,
            timezone = clock.zone.id,
            from = from,
            to = to,
            appointments = entries,
            // Yoğunluk personel filtresinden ETKİLENMEZ — sunucudaki davranış bu.
            density = MockBookingSeed.density(visible(from, to, staffProfileId = null), clock),
        )
    }

    private fun visible(
        from: Instant,
        to: Instant,
        staffProfileId: String?,
    ): List<CalendarEntry> =
        MockBookingSeed
            .entries(scenario, clock, mockClock.reference)
            // Oturum içi değişiklikler LİSTEYE de yansımalı: detayda "Geldi" yapıp
            // geri dönünce hâlâ "Planlandı" gören bir kullanıcı, kaydının gitmediğini
            // düşünür.
            .map { entry ->
                edits[entry.id]?.let {
                    entry.copy(status = it.status, notes = it.notes, version = it.version)
                } ?: entry
            }
            // Yarı açık aralık [from, to) — sunucunun sözleşmesi.
            // Oturum içinde oluşturulanlar da listeye girer; girmezlerse kullanıcı
            // "oluşturdum ama takvimde yok" görür ve bu, çift randevu denemesine yol açar.
            .plus(extras.map { it.calendarEntry() })
            .filter { it.startsAt < to && it.endsAt > from }
            .filter { entry -> staffProfileId == null || staffProfileId in entry.staffProfileIds }
            .sortedBy { it.startsAt }

    /** Detay kaydını takvim satırına indirger — oluşturulan randevular listeye böyle girer. */
    private fun Appointment.calendarEntry(): CalendarEntry =
        CalendarEntry(
            id = id,
            branchId = branchId,
            customerId = customerId,
            customerName = MockCustomers.byId(customerId)?.fullName ?: "Müşteri",
            customerPhone = MockCustomers.byId(customerId)?.phone,
            status = status,
            startsAt = startsAt,
            endsAt = endsAt,
            notes = notes,
            version = version,
            totalMinor = totalMinor,
            services =
                services.map { line ->
                    CalendarEntryServiceLine(
                        id = line.id,
                        serviceId = line.serviceId,
                        serviceName =
                            catalog().firstOrNull { it.id == line.serviceId }?.name ?: "Hizmet",
                        staffProfileId = line.staffProfileId,
                        sortOrder = line.sortOrder,
                        startsAt = line.startsAt,
                        endsAt = line.endsAt,
                        priceMinor = line.priceMinor,
                    )
                },
        )

    /** Personelin o günkü çalışma aralıkları; takvim bağlı değilse sabit 09:00–18:00. */
    private fun workingWindows(
        staffId: String,
        branchId: String,
        day: Instant,
    ): List<ClosedRange<Instant>> =
        scheduling?.workingIntervals(staffId, branchId, day)
            ?: listOf(clock.date(day, ClockTime.nineAM)..clock.date(day, ClockTime.sixPM))

    private fun CalendarEntry.overlaps(
        from: Instant,
        to: Instant,
    ): Boolean = startsAt < to && endsAt > from

    private fun failure(): ApiError? = ApiError.Network().takeIf { failing }

    private suspend fun simulateLatency() {
        if (!latencyEnabled) return
        delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
    }

    private companion object {
        const val MIN_LATENCY_MILLIS = 150L
        const val MAX_LATENCY_MILLIS = 500L
        const val DAYS_PER_WEEK = 7L
        const val HTTP_CONFLICT = 409
        const val HTTP_NOT_FOUND = 404
        const val SLOT_GRANULARITY_MINUTES = 15
        const val DEFAULT_SLOT_MINUTES = 30
        const val SUGGESTION_LIMIT = 3
        const val SUGGESTION_STEP_MINUTES = 15
        const val NEW_ID_BASE = 900
    }
}
