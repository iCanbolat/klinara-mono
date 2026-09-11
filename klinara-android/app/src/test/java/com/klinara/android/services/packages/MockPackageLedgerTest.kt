package com.klinara.android.services.packages

import com.klinara.android.services.booking.AppointmentServiceInput
import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.booking.CreateAppointmentInput
import com.klinara.android.services.booking.MockBookingService
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.mock.MockDataScenario
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.util.UUID

/**
 * Defter matematiği ve kalan hak — iOS `Phase5StoreTests` paritesi ve fazın çıkış ölçütü:
 * **kalan seans hiçbir akışta negatife düşmüyor ve kalan hak defterle ayrışmıyor.**
 */
class MockPackageLedgerTest {
    private val booking = MockBookingService(scenario = MockDataScenario.EmptyDay, latencyEnabled = false)
    private val service =
        MockPackagesService(latencyEnabled = false, booking = booking).also { booking.packageHook = it }

    private suspend fun ayse() = service.customerPackage(MockPackagesSeed.SOLD_AYSE_PACKAGE)

    /** Her kalem için: defter satırlarının toplamı == sunucunun söylediği kalan hak. */
    private suspend fun assertLedgerMatches(packageId: String) {
        val pkg = service.customerPackage(packageId)
        val ledger = service.ledger(packageId).data
        pkg.items.forEach { item ->
            val sum = ledger.filter { it.customerPackageItemId == item.id }.sumOf { it.delta }
            assertEquals(item.remainingSessions, sum, "${item.serviceName}: defter ile kalan hak AYRIŞTI")
            assertTrue(item.remainingSessions >= 0, "${item.serviceName}: kalan hak eksiye düştü")
        }
        assertEquals(pkg.remainingSessions, pkg.items.sumOf { it.remainingSessions })
    }

    private fun bindLine(
        appointmentServiceId: String,
        itemId: String,
    ) = ConsumePackageInput(listOf(ConsumePackageLineInput(appointmentServiceId, itemId)))

    private suspend fun codeOf(block: suspend () -> Unit): ApiErrorCode? =
        try {
            block()
            null
        } catch (error: ApiError) {
            error.code
        }

    private suspend fun laserAppointmentForAyse(): com.klinara.android.services.booking.Appointment =
        booking.create(
            CreateAppointmentInput(
                branchId = MockIds.BRANCH_NISANTASI,
                customerId = MockPackagesSeed.AYSE_ID,
                startsAt = "2026-12-01T10:00:00+03:00",
                services = listOf(AppointmentServiceInput(MockIds.SERVICE_LASER, MockIds.STAFF_DERYA)),
            ),
            idempotencyKey = UUID.randomUUID().toString(),
        )

    private suspend fun complete(appointmentId: String) {
        booking.changeStatus(appointmentId, AppointmentStatus.Arrived, null)
        booking.changeStatus(appointmentId, AppointmentStatus.InProgress, null)
        booking.changeStatus(appointmentId, AppointmentStatus.Completed, null)
    }

    @Test
    @DisplayName("Seed defteri: satırların toplamı kalan hakkı veriyor — lazer 6, bakım 1, toplam 7")
    fun seedLedgerSumsToRemaining() =
        runTest {
            val pkg = ayse()

            assertEquals(7, pkg.remainingSessions)
            assertEquals(listOf(6, 1), pkg.sortedItems.map { it.remainingSessions })
            assertLedgerMatches(pkg.id)
        }

    @Test
    @DisplayName("Satış tutarı kalemlere kuruşu kuruşuna dağıtılıyor (largest-remainder)")
    fun allocationNeverLosesAKurus() {
        val shares = MockPackagesSeed.allocate(1_250_000, listOf(1_450_000, 180_000))

        assertEquals(1_250_000L, shares.sum())
        assertEquals(listOf(1_111_963L, 138_037L), shares)
        assertEquals(100L, MockPackagesSeed.allocate(100, listOf(1, 1, 1)).sum())
        assertEquals(listOf(34L, 33L, 33L), MockPackagesSeed.allocate(100, listOf(0, 0, 0)))
    }

    @Test
    @DisplayName("Aynı anahtarla ikinci satış YENİ paket üretmiyor, ilkini döndürüyor")
    fun sellIsIdempotent() =
        runTest {
            val input = CreateCustomerPackageInput(MockPackagesSeed.AYSE_ID, MockPackagesSeed.DEFINITION_LASER_10)

            val first = service.sell(input, idempotencyKey = "satis-1")
            val second = service.sell(input, idempotencyKey = "satis-1")

            assertEquals(first.id, second.id)
            assertEquals(2, service.packages(MockPackagesSeed.AYSE_ID).data.size)
            assertEquals(12, first.remainingSessions)
            assertLedgerMatches(first.id)
        }

    @Test
    @DisplayName("Pasif tanım satılamıyor")
    fun inactiveDefinitionCannotBeSold() =
        runTest {
            val definition = service.definition(MockPackagesSeed.DEFINITION_LASER_10)
            service.retireDefinition(definition.id, definition.version)

            val code =
                codeOf {
                    service.sell(CreateCustomerPackageInput(MockPackagesSeed.AYSE_ID, definition.id), "satis-2")
                }

            assertEquals(ApiErrorCode.VALIDATION_FAILED, code)
        }

    @Test
    @DisplayName("Kullanılabilir haklar yalnız kalanı olan kalemleri ve istenen hizmeti döndürüyor")
    fun entitlementsFilter() =
        runTest {
            val laserOnly = service.entitlements(MockPackagesSeed.AYSE_ID, serviceId = MockIds.SERVICE_LASER)

            assertEquals(listOf(MockPackagesSeed.SOLD_AYSE_ITEM_LASER), laserOnly.map { it.customerPackageItemId })
            assertTrue(service.entitlements(MockIds.STAFF_DERYA).isEmpty(), "Paketi olmayan müşteride boş")
        }

    @Test
    @DisplayName("Tamamlanmamış randevuya bağlama: bound 1, consumed 0 ve kalan hak DEĞİŞMİYOR")
    fun bindingBeforeCompletionDoesNotConsume() =
        runTest {
            val appointment = laserAppointmentForAyse()
            val line = appointment.services.single()

            val result =
                service.consume(
                    appointment.id,
                    bindLine(line.id, MockPackagesSeed.SOLD_AYSE_ITEM_LASER),
                    idempotencyKey = "bagla-1",
                )

            assertEquals(ConsumePackageResult(bound = 1, consumed = 0), result)
            assertEquals(7, ayse().remainingSessions)
            assertNotNull(booking.appointment(appointment.id).services.single().customerPackageItemId)
        }

    @Test
    @DisplayName("Bağlı randevu TAMAMLANINCA seans düşüyor; yeniden açılınca TERS KAYITLA geri geliyor")
    fun completionConsumesAndReopenReverses() =
        runTest {
            val appointment = laserAppointmentForAyse()
            service.consume(
                appointment.id,
                bindLine(appointment.services.single().id, MockPackagesSeed.SOLD_AYSE_ITEM_LASER),
                idempotencyKey = "bagla-2",
            )

            complete(appointment.id)
            assertEquals(5, ayse().sortedItems[0].remainingSessions)
            assertLedgerMatches(MockPackagesSeed.SOLD_AYSE_PACKAGE)

            booking.changeStatus(appointment.id, AppointmentStatus.InProgress, "Yanlış tamamlandı")
            val ledger = service.ledger(MockPackagesSeed.SOLD_AYSE_PACKAGE).data
            assertEquals(6, ayse().sortedItems[0].remainingSessions)
            // Satır silinmedi: tüketim YERİNDE, üstüne onu geri alan bir satır eklendi.
            assertTrue(ledger.first().isReversal)
            assertTrue(ledger.any { it.id == ledger.first().reversesEntryId && it.delta == -1 })
            assertLedgerMatches(MockPackagesSeed.SOLD_AYSE_PACKAGE)
        }

    @Test
    @DisplayName("Tamamlanmış randevuya bağlama AYNI çağrıda düşürüyor")
    fun bindingACompletedAppointmentConsumesImmediately() =
        runTest {
            val appointment = laserAppointmentForAyse()
            complete(appointment.id)

            val result =
                service.consume(
                    appointment.id,
                    bindLine(appointment.services.single().id, MockPackagesSeed.SOLD_AYSE_ITEM_LASER),
                    idempotencyKey = "bagla-3",
                )

            assertEquals(1, result.consumed)
            assertEquals(6, ayse().remainingSessions)
            assertLedgerMatches(MockPackagesSeed.SOLD_AYSE_PACKAGE)
        }

    @Test
    @DisplayName("Hak bitmişken tamamlama PACKAGE_EXHAUSTED veriyor ve randevu durumu DEĞİŞMİYOR")
    fun exhaustedBlocksCompletion() =
        runTest {
            // Bakım kalemi 1 hakta: iki randevu bağlanıyor, ikincisinin tamamlanması düşmemeli.
            val skinFirst = skinAppointment("2026-12-02T10:00:00+03:00")
            val skinSecond = skinAppointment("2026-12-03T10:00:00+03:00")
            complete(skinFirst)

            booking.changeStatus(skinSecond, AppointmentStatus.Arrived, null)
            booking.changeStatus(skinSecond, AppointmentStatus.InProgress, null)
            val code = codeOf { booking.changeStatus(skinSecond, AppointmentStatus.Completed, null) }

            assertEquals(ApiErrorCode.PACKAGE_EXHAUSTED, code)
            assertEquals(AppointmentStatus.InProgress, booking.appointment(skinSecond).status)
            assertEquals(0, ayse().sortedItems[1].remainingSessions)
            assertLedgerMatches(MockPackagesSeed.SOLD_AYSE_PACKAGE)
        }

    @Test
    @DisplayName("Başka hizmetin kalemine bağlama reddediliyor — 12 seansın hepsi lazer olamaz")
    fun serviceMismatchRejected() =
        runTest {
            val appointment = laserAppointmentForAyse()

            val code =
                codeOf {
                    service.consume(
                        appointment.id,
                        bindLine(appointment.services.single().id, MockPackagesSeed.SOLD_AYSE_ITEM_SKIN),
                        idempotencyKey = "bagla-4",
                    )
                }

            assertEquals(ApiErrorCode.VALIDATION_FAILED, code)
            assertEquals(7, ayse().remainingSessions)
        }

    private suspend fun skinAppointment(startsAt: String): String {
        val appointment =
            booking.create(
                CreateAppointmentInput(
                    branchId = MockIds.BRANCH_NISANTASI,
                    customerId = MockPackagesSeed.AYSE_ID,
                    startsAt = startsAt,
                    services = listOf(AppointmentServiceInput(MockIds.SERVICE_SKIN_CARE, MockIds.STAFF_DERYA)),
                ),
                idempotencyKey = UUID.randomUUID().toString(),
            )
        service.consume(
            appointment.id,
            bindLine(appointment.services.single().id, MockPackagesSeed.SOLD_AYSE_ITEM_SKIN),
            idempotencyKey = UUID.randomUUID().toString(),
        )
        return appointment.id
    }
}
