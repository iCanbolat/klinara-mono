package com.klinara.android.features.calendar.booking

import com.klinara.android.services.booking.AppointmentListQuery
import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.booking.AvailabilityQuery
import com.klinara.android.services.booking.BookingService
import com.klinara.android.services.booking.CalendarDayQuery
import com.klinara.android.services.booking.CalendarEntry
import com.klinara.android.services.booking.CalendarWeekQuery
import com.klinara.android.services.booking.CreateAppointmentInput
import com.klinara.android.services.booking.MockBookingService
import com.klinara.android.services.booking.RescheduleAppointmentInput
import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.crm.MockCustomerService
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.mock.MockClock
import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.mock.MockDataScenario
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Page
import com.klinara.android.services.staff.MockStaffService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class BookingFlowTest {
    private val dispatcher = StandardTestDispatcher()
    private val clock = BranchClock("Europe/Istanbul")
    private val today = Instant.parse("2026-09-09T09:00:00Z")
    private val mockClock = MockClock(clock, today)

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    private fun service(scenario: MockDataScenario = MockDataScenario.BusyDay) =
        MockBookingService(scenario, clock, mockClock, latencyEnabled = false)

    private fun model(
        booking: BookingService,
        startingAt: Instant? = mockClock.reference,
    ) = BookingFlowViewModel(
        booking = booking,
        catalog = MockCatalogService(latencyEnabled = false),
        staff = MockStaffService(latencyEnabled = false),
        customers = MockCustomerService(latencyEnabled = false),
        clock = clock,
        branchId = MockIds.BRANCH_NISANTASI,
        startingAt = startingAt,
    )

    /** `create` çağrılarının idempotency anahtarlarını biriktirir. */
    private class KeyRecorder(
        private val delegate: MockBookingService,
    ) : BookingService by delegate {
        val keys = mutableListOf<String>()

        override suspend fun create(
            input: CreateAppointmentInput,
            idempotencyKey: String,
        ): com.klinara.android.services.booking.Appointment {
            keys += idempotencyKey
            return delegate.create(input, idempotencyKey)
        }
    }

    // --- Uygunluk ---

    @Test
    @DisplayName("Hizmet seçilmeden uygunluk İSTENMEZ")
    fun availabilityIsNotRequestedWithoutServices() =
        runTest {
            val subject = model(service())
            subject.loadSlots()
            advanceUntilIdle()

            assertTrue(subject.state.value.visibleSlots.isEmpty())
        }

    @Test
    @DisplayName("Uygunluk anahtarı gün, hizmet ve personelle değişir")
    fun availabilityKeyTracksTheThreeInputs() {
        val subject = model(service())
        val base = subject.availabilityKey()

        subject.toggleService(MockIds.SERVICE_SKIN_CARE)
        val withService = subject.availabilityKey()
        assertTrue(base != withService)

        subject.selectStaff(MockIds.STAFF_DERYA)
        assertTrue(withService != subject.availabilityKey())

        val withStaff = subject.availabilityKey()
        subject.stepDay(1)
        assertTrue(withStaff != subject.availabilityKey())
    }

    @Test
    @DisplayName("Dolu saatler uygunluk listesinde ÇIKMAZ")
    fun busyHoursAreExcludedFromAvailability() =
        runTest {
            val subject = model(service())
            subject.toggleService(MockIds.SERVICE_SKIN_CARE)
            subject.selectStaff(MockIds.STAFF_DERYA)
            subject.loadSlots()
            advanceUntilIdle()

            val slots = subject.state.value.visibleSlots
            assertTrue(slots.isNotEmpty(), "Boş bir motor çakışma akışını sürülemez yapardı.")
            // Derya'nın 09:00–10:00 randevusu var; o başlangıç uygun görünmemeli.
            val nine = nineAM()
            assertTrue(slots.none { it.startsAt == nine })
        }

    @Test
    @DisplayName("Uygunluk adayları YETKİNLİĞE göre süzülür")
    fun availabilityCandidatesAreCompetent() =
        runTest {
            // Emülatörde yakalandı: mock "3 kişi uygun" diyordu ama Onur cilt bakımı
            // vermiyor. Kullanıcı o slotu seçseydi canlı sunucu 422 RESOURCE_UNAVAILABLE
            // ile reddederdi — mock'ta doğru görünüp canlıda bozulan bir ekran.
            val subject = model(service(MockDataScenario.EmptyDay))
            subject.toggleService(MockIds.SERVICE_SKIN_CARE)
            subject.loadSlots()
            advanceUntilIdle()

            val everyCandidate =
                subject.state.value.visibleSlots
                    .flatMap { it.staffProfileIds }
                    .distinct()
            assertTrue(everyCandidate.isNotEmpty())
            assertTrue(
                MockIds.STAFF_ONUR !in everyCandidate,
                "Onur cilt bakımında yetkin değil; aday listesinde görünmemeli.",
            )
        }

    // --- Çift dokunuş ve idempotency ---

    @Test
    @DisplayName("Çift dokunuş TEK randevu üretir")
    fun doubleTapCreatesOneAppointment() =
        runTest {
            val recorder = KeyRecorder(service(MockDataScenario.EmptyDay))
            val subject = model(recorder)
            subject.load()
            advanceUntilIdle()

            subject.selectCustomer(MockCustomers.ALL.first().id)
            subject.toggleService(MockIds.SERVICE_SKIN_CARE)
            subject.loadSlots()
            advanceUntilIdle()
            subject.selectSlot(subject.state.value.visibleSlots.first())

            // İki kez ard arda: ikincisi `isSaving` bayrağına takılmalı.
            subject.save()
            subject.save()
            advanceUntilIdle()

            assertEquals(1, recorder.keys.size, "Çift dokunuşu engelleyen şey `isSaving` bayrağı.")
            assertNotNull(subject.state.value.created)
        }

    @Test
    @DisplayName("Her deneme YENİ bir idempotency anahtarı kullanır")
    fun eachAttemptUsesAFreshKey() =
        runTest {
            val recorder = KeyRecorder(service(MockDataScenario.EmptyDay))
            val subject = model(recorder)
            subject.load()
            advanceUntilIdle()
            subject.selectCustomer(MockCustomers.ALL.first().id)
            subject.toggleService(MockIds.SERVICE_SKIN_CARE)
            subject.loadSlots()
            advanceUntilIdle()

            subject.selectSlot(subject.state.value.visibleSlots.first())
            subject.save()
            advanceUntilIdle()

            subject.selectSlot(subject.state.value.visibleSlots.last())
            subject.save()
            advanceUntilIdle()

            assertEquals(2, recorder.keys.size)
            assertEquals(
                2,
                recorder.keys.distinct().size,
                "Düzeltilmiş bir gövdeyi aynı anahtarla göndermek 409 IDEMPOTENCY_CONFLICT verirdi.",
            )
        }

    // --- Çakışma ---

    @Test
    @DisplayName("409 SLOT_CONFLICT bir hata AFİŞİ değil, alternatifler sayfası açar")
    fun slotConflictOpensSuggestionsNotAnErrorBanner() =
        runTest {
            val booking = service()
            val subject = model(booking)
            subject.load()
            advanceUntilIdle()
            subject.selectCustomer(MockCustomers.ALL.first().id)
            subject.toggleService(MockIds.SERVICE_SKIN_CARE)
            subject.selectStaff(MockIds.STAFF_DERYA)

            // Derya'nın DOLU olduğu saati elle seç: uygunluk listesinde yok ama
            // kullanıcı önceden seçmiş olabilir (hizmet değişimi, yarış).
            val nine = nineAM()
            subject.selectSlot(
                com.klinara.android.services.booking.AvailabilitySlot(
                    startsAt = nine,
                    endsAt = clock.addingMinutes(60, nine),
                    staffProfileIds = listOf(MockIds.STAFF_DERYA),
                ),
            )
            subject.save()
            advanceUntilIdle()

            val state = subject.state.value
            assertNull(state.error, "Çakışma bir hata metnine indirgenmemeli.")
            assertNotNull(state.conflict, "Alternatif saatler sayfası açılmalı.")
            assertEquals(ApiErrorCode.SLOT_CONFLICT, state.conflict?.code)
            assertTrue(state.conflict?.slotSuggestions?.isNotEmpty() == true)
            assertTrue(
                state.conflict?.slotConflicts?.all { it.resourceId != null && it.from != null } == true,
                "`resourceId`/`from`/`to` çözülmezse 'dolu olan' satırı boş çizilir.",
            )
            assertNull(state.draft.slot, "Dolu slot düşürülmeli; kullanıcı aynı saati tekrar denememeli.")
        }

    @Test
    @DisplayName("Öneriye dokunmak taslağı DOLDURUR, kaydetmez")
    fun applyingASuggestionFillsButDoesNotSave() =
        runTest {
            val recorder = KeyRecorder(service())
            val subject = model(recorder)
            subject.load()
            advanceUntilIdle()
            subject.selectCustomer(MockCustomers.ALL.first().id)
            subject.toggleService(MockIds.SERVICE_SKIN_CARE)
            subject.selectStaff(MockIds.STAFF_DERYA)
            val nine = nineAM()
            subject.selectSlot(
                com.klinara.android.services.booking.AvailabilitySlot(
                    startsAt = nine,
                    endsAt = clock.addingMinutes(60, nine),
                    staffProfileIds = listOf(MockIds.STAFF_DERYA),
                ),
            )
            subject.save()
            advanceUntilIdle()

            val suggestion = subject.state.value.conflict!!.slotSuggestions.first()
            subject.applySuggestion(
                com.klinara.android.services.booking.AvailabilitySlot(
                    startsAt = suggestion.startsAt,
                    endsAt = suggestion.endsAt,
                    staffProfileIds = suggestion.staffProfileIds,
                ),
            )
            advanceUntilIdle()

            assertEquals(suggestion.startsAt, subject.state.value.draft.slot?.startsAt)
            assertNull(subject.state.value.conflict, "Sayfa kapanmalı.")
            assertEquals(1, recorder.keys.size, "Son sözü kullanıcı söyler: öneri KAYDETMEZ.")
        }

    // --- Erteleme ---

    @Test
    @DisplayName("Erteleme saati taşır, hizmet dizilimini korur")
    fun rescheduleMovesTheTime() =
        runTest {
            val booking = service()
            val id =
                booking
                    .calendarDay(
                        CalendarDayQuery(
                            branchId = MockIds.BRANCH_NISANTASI,
                            date = clock.localDateString(mockClock.reference),
                        ),
                    ).appointments
                    .first { it.status == AppointmentStatus.Scheduled }
                    .id
            val existing = booking.appointment(id)

            val moved =
                booking.reschedule(
                    id,
                    existing.version,
                    RescheduleAppointmentInput(
                        startsAt = clock.wireValue(clock.addingMinutes(RESCHEDULE_SHIFT, existing.startsAt)),
                        reason = "Müşteri talebi",
                    ),
                )

            assertEquals(existing.services.size, moved.services.size)
            assertEquals(
                clock.minutes(existing.startsAt, existing.endsAt),
                clock.minutes(moved.startsAt, moved.endsAt),
                "Erteleme süreyi DEĞİŞTİRMEZ.",
            )
            assertTrue(booking.history(id).last().newStartsAt != null, "Geçmişte yeni saat görünmeli.")
        }

    @Test
    @DisplayName("Kapanmış randevu ERTELENEMEZ")
    fun closedAppointmentsCannotBeRescheduled() =
        runTest {
            val booking = service()
            val cancelled =
                booking
                    .calendarDay(
                        CalendarDayQuery(
                            branchId = MockIds.BRANCH_NISANTASI,
                            date = clock.localDateString(mockClock.reference),
                        ),
                    ).appointments
                    .first { it.status == AppointmentStatus.Cancelled }
            val existing = booking.appointment(cancelled.id)

            val error =
                runCatching {
                    booking.reschedule(
                        cancelled.id,
                        existing.version,
                        RescheduleAppointmentInput(startsAt = clock.wireValue(existing.startsAt)),
                    )
                }.exceptionOrNull()

            assertTrue(error is ApiError)
        }

    @Test
    @DisplayName("Oluşturulan randevu TAKVİMDE görünür")
    fun createdAppointmentsAppearOnTheCalendar() =
        runTest {
            val booking = service(MockDataScenario.EmptyDay)
            val subject = model(booking)
            subject.load()
            advanceUntilIdle()
            subject.selectCustomer(MockCustomers.ALL.first().id)
            subject.toggleService(MockIds.SERVICE_SKIN_CARE)
            subject.loadSlots()
            advanceUntilIdle()
            subject.selectSlot(subject.state.value.visibleSlots.first())
            subject.save()
            advanceUntilIdle()

            val created = subject.state.value.created!!
            val day =
                booking.calendarDay(
                    CalendarDayQuery(
                        branchId = MockIds.BRANCH_NISANTASI,
                        date = clock.localDateString(created.startsAt),
                    ),
                )
            assertTrue(
                day.appointments.any { it.id == created.id },
                "\"Oluşturdum ama takvimde yok\", çift randevu denemesine yol açar.",
            )
        }

    /** Tohumda Derya'nın DOLU olduğu saat — çakışma akışının çıpası. */
    private fun nineAM(): Instant = clock.date(clock.startOfDay(mockClock.reference), ClockTime.nineAM)

    private companion object {
        const val RESCHEDULE_SHIFT = 120L
    }
}
