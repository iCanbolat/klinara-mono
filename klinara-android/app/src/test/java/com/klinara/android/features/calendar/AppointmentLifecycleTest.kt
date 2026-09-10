package com.klinara.android.features.calendar

import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.booking.MockBookingService
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.crm.MockCustomerService
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.mock.MockClock
import com.klinara.android.services.mock.MockDataScenario
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.Loadable
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
class AppointmentLifecycleTest {
    private val dispatcher = StandardTestDispatcher()
    private val clock = BranchClock("Europe/Istanbul")
    private val today = Instant.parse("2026-09-09T09:00:00Z")

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    private fun booking() =
        MockBookingService(MockDataScenario.BusyDay, clock, MockClock(clock, today), latencyEnabled = false)

    private suspend fun firstScheduledId(service: MockBookingService): String =
        service
            .calendarDay(
                com.klinara.android.services.booking.CalendarDayQuery(
                    branchId = com.klinara.android.services.mock.MockIds.BRANCH_NISANTASI,
                    date = clock.localDateString(MockClock(clock, today).reference),
                ),
            ).appointments
            .first { it.status == AppointmentStatus.Scheduled }
            .id

    // --- Geçiş tablosu: sunucunun durum makinesiyle birebir ---

    @Test
    @DisplayName("Geçiş tablosu sunucununkiyle birebir")
    fun transitionTableMatchesTheServer() {
        assertEquals(
            listOf(AppointmentStatus.Confirmed, AppointmentStatus.Arrived, AppointmentStatus.NoShow),
            AppointmentStatus.Scheduled.allowedTransitions(canReopen = false),
        )
        assertEquals(
            listOf(AppointmentStatus.Arrived, AppointmentStatus.NoShow),
            AppointmentStatus.Confirmed.allowedTransitions(canReopen = false),
        )
        assertEquals(
            listOf(AppointmentStatus.InProgress, AppointmentStatus.NoShow),
            AppointmentStatus.Arrived.allowedTransitions(canReopen = false),
        )
        assertEquals(
            listOf(AppointmentStatus.Completed),
            AppointmentStatus.InProgress.allowedTransitions(canReopen = false),
        )
    }

    @Test
    @DisplayName("`appointment:reopen` YOKSA tamamlanmış randevuda hiç düğme çıkmaz")
    fun reopenIsGatedByPermission() {
        assertTrue(
            AppointmentStatus.Completed.allowedTransitions(canReopen = false).isEmpty(),
            "İzinsiz kullanıcı 403 ile karşılaşmamalı; giriş noktası HİÇ görünmemeli (§7.4).",
        )
        assertEquals(
            listOf(AppointmentStatus.InProgress),
            AppointmentStatus.Completed.allowedTransitions(canReopen = true),
        )
    }

    @Test
    @DisplayName("İptal durum listesinde YOK — kendi sebep toplayan akışı var")
    fun cancelIsNotInTheStatusList() {
        AppointmentStatus.entries.forEach { status ->
            assertTrue(
                AppointmentStatus.Cancelled !in status.allowedTransitions(canReopen = true),
                "İptal durum satırı olarak çizilseydi aynı işe iki kapı açılır, " +
                    "birinden sebep sorulmazdı.",
            )
        }
    }

    @Test
    @DisplayName("Terminal ve bilinmeyen durumlar hiç geçiş üretmez")
    fun terminalAndUnknownProduceNothing() {
        assertTrue(AppointmentStatus.NoShow.allowedTransitions(canReopen = true).isEmpty())
        assertTrue(AppointmentStatus.Cancelled.allowedTransitions(canReopen = true).isEmpty())
        assertTrue(
            AppointmentStatus.Unknown.allowedTransitions(canReopen = true).isEmpty(),
            "Tanımadığımız bir durumdan nereye gidilebileceğini de bilmiyoruz; " +
                "tahmin etmek sunucuda 409 yer.",
        )
    }

    @Test
    @DisplayName("Kapanmış ve tamamlanmış randevu ERTELENEMEZ")
    fun rescheduleIsBlockedForClosedAppointments() {
        assertTrue(AppointmentStatus.Scheduled.canReschedule)
        assertTrue(!AppointmentStatus.Cancelled.canReschedule)
        assertTrue(!AppointmentStatus.NoShow.canReschedule)
        assertTrue(!AppointmentStatus.Completed.canReschedule)
    }

    // --- Sürüm kaynağı: batch'in en sinsi hatası ---

    @Test
    @DisplayName("Durum değişikliği sürümü GÖVDEDEN getirir — sonraki not kaydı 409 almaz")
    fun versionComesFromTheResponseBody() =
        runTest {
            // `cancel` ve `status` uçları ETag DÖNDÜRMÜYOR. Ekran sürümü gövdeden
            // almazsa, bir sonraki `PATCH` kullanıcının KENDİ değişikliği yüzünden
            // 409 alır — ve bu ancak canlıda fark edilirdi.
            val service = booking()
            val id = firstScheduledId(service)

            val before = service.appointment(id)
            val after = service.changeStatus(id, AppointmentStatus.Confirmed)
            assertEquals(before.version + 1, after.version)

            // Gövdeden gelen sürümle not kaydı geçmeli.
            val noted = service.updateNotes(id, after.version, "Kapıda karşılandı")
            assertEquals("Kapıda karşılandı", noted.notes)
        }

    @Test
    @DisplayName("Bayat sürümle not kaydı 409 VERSION_CONFLICT")
    fun staleVersionIsRejected() =
        runTest {
            val service = booking()
            val id = firstScheduledId(service)
            val before = service.appointment(id)
            service.changeStatus(id, AppointmentStatus.Confirmed)

            val error = runCatching { service.updateNotes(id, before.version, "geç kalmış") }.exceptionOrNull()

            assertTrue(error is ApiError)
            assertEquals(ApiErrorCode.VERSION_CONFLICT, (error as ApiError).code)
        }

    @Test
    @DisplayName("Aynı duruma geçiş bir HATA DEĞİL, sessiz bir no-op")
    fun sameStatusIsANoOp() =
        runTest {
            val service = booking()
            val id = firstScheduledId(service)
            val before = service.appointment(id)

            val after = service.changeStatus(id, before.status)

            assertEquals(before.version, after.version, "No-op sürüm artırmamalı.")
        }

    @Test
    @DisplayName("Geçersiz geçiş 409 ile reddedilir")
    fun invalidTransitionIsRejected() =
        runTest {
            val service = booking()
            val id = firstScheduledId(service)

            val error =
                runCatching { service.changeStatus(id, AppointmentStatus.Completed) }.exceptionOrNull()

            assertTrue(error is ApiError)
            assertTrue((error as ApiError).displayMessage.isNotBlank())
        }

    @Test
    @DisplayName("Durum değişikliği TAKVİM LİSTESİNE de yansır")
    fun mutationsAreVisibleInTheList() =
        runTest {
            // Detayda "Geldi" yapıp geri dönünce hâlâ "Planlandı" gören bir kullanıcı,
            // kaydının gitmediğini düşünür.
            val service = booking()
            val id = firstScheduledId(service)
            service.changeStatus(id, AppointmentStatus.Confirmed)

            val query =
                com.klinara.android.services.booking.CalendarDayQuery(
                    branchId = com.klinara.android.services.mock.MockIds.BRANCH_NISANTASI,
                    date = clock.localDateString(MockClock(clock, today).reference),
                )
            val row = service.calendarDay(query).appointments.first { it.id == id }
            assertEquals(AppointmentStatus.Confirmed, row.status)
        }

    // --- Not silme ---

    @Test
    @DisplayName("Boş not `null` gönderir — not SİLİNİR")
    fun emptyNoteDeletesTheNote() =
        runTest {
            val service = booking()
            val id = firstScheduledId(service)
            val withNote = service.updateNotes(id, service.appointment(id).version, "geçici")
            assertNotNull(withNote.notes)

            val model = AppointmentDetailViewModel(
                service,
                MockStaffService(latencyEnabled = false),
                MockCustomerService(latencyEnabled = false),
                id,
            )
            model.load()
            advanceUntilIdle()
            model.saveNotes("   ")
            advanceUntilIdle()

            val after = (model.state.value.appointment as Loadable.Loaded).value
            assertNull(after.notes, "Boşluktan ibaret bir not, not değildir.")
        }

    // --- Yazma hatası ekranı boşaltmaz ---

    @Test
    @DisplayName("Yazma hatası kaydı ekrandan SİLMEZ, yalnız afiş gösterir")
    fun writeFailureKeepsTheRecordOnScreen() =
        runTest {
            val service = booking()
            val id = firstScheduledId(service)
            val model = AppointmentDetailViewModel(
                service,
                MockStaffService(latencyEnabled = false),
                MockCustomerService(latencyEnabled = false),
                id,
            )
            model.load()
            advanceUntilIdle()

            // Geçersiz geçiş: sunucu reddedecek.
            model.askStatus(AppointmentStatus.Completed)
            model.confirmStatus()
            advanceUntilIdle()

            assertTrue(model.state.value.appointment is Loadable.Loaded, "Kayıt ekranda kalmalı.")
            assertNotNull(model.state.value.error, "Hata bir afişe dönüşmeli.")
            assertEquals(
                AppointmentStatus.Scheduled,
                (model.state.value.appointment as Loadable.Loaded).value.status,
                "İyimser güncelleme YOK: gerçekleşmemiş bir durum bir an bile gösterilmemeli.",
            )
        }

    @Test
    @DisplayName("Var olmayan randevu 404 — 'yetkiniz yok' DEĞİL")
    fun missingAppointmentIsNotFound() =
        runTest {
            val error = runCatching { booking().appointment("yok-böyle-bir-id") }.exceptionOrNull()

            assertEquals(ApiErrorCode.NOT_FOUND, (error as ApiError).code)
        }

    @Test
    @DisplayName("Geçmiş en az bir 'oluşturuldu' kaydı taşır ve değişiklikleri biriktirir")
    fun historyAccumulates() =
        runTest {
            val service = booking()
            val id = firstScheduledId(service)
            assertEquals(1, service.history(id).size)

            service.changeStatus(id, AppointmentStatus.Confirmed, reason = "Telefonla onaylandı")
            val trail = service.history(id)

            assertEquals(2, trail.size)
            assertEquals(AppointmentStatus.Scheduled, trail.last().fromStatus)
            assertEquals(AppointmentStatus.Confirmed, trail.last().toStatus)
            assertEquals("Telefonla onaylandı", trail.last().reason)
        }

    @Test
    @DisplayName("Tampon süresi görünen süreden BÜYÜK — dipnot sürülebilir")
    fun bufferedDurationExceedsVisibleDuration() =
        runTest {
            val appointment = booking().appointment(firstScheduledId(booking()))

            assertTrue(
                appointment.occupiedMinutes > appointment.visibleMinutes,
                "Müşteri 14:00 görür, takvim 13:55–15:10 tutar; bu fark ekranda söylenmeli.",
            )
        }
}
