package com.klinara.android.services.booking

import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ProblemDetails
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * Çözümleme sözleşmesi.
 *
 * Fixture'lar sunucudan yakalanmış gerçek gövdelerdir ve **üretim çözümleyicisiyle**
 * okunur; elle kurulmuş nesneler bir sözleşme kaymasını gizlerdi.
 */
class BookingModelsTest {
    private fun <T> decode(
        path: String,
        deserializer: kotlinx.serialization.DeserializationStrategy<T>,
    ): T = KlinaraJson.decodeFromString(deserializer, Fixtures.read(path))

    @Test
    @DisplayName("Gün yanıtı çözülüyor ve şube offset'i korunuyor")
    fun calendarDayDecodes() {
        val response = decode("booking/calendar-day.json", CalendarResponse.serializer())

        assertEquals("Europe/Istanbul", response.timezone)
        assertEquals(2, response.appointments.size)
        // +03:00 offset'li giriş UTC'ye çevrilir; saat kaymamalı.
        assertEquals(Instant.parse("2026-09-07T06:00:00Z"), response.appointments.first().startsAt)
        assertEquals(AppointmentStatus.Confirmed, response.appointments.first().status)
        assertEquals(90_000L, response.appointments.first().totalMinor)
    }

    @Test
    @DisplayName("`localDay` çıplak bir STRING kalır — cihaz dilimine hiç uğramaz")
    fun densityLocalDayStaysAString() {
        val response = decode("booking/calendar-day.json", CalendarResponse.serializer())

        assertEquals("2026-09-07", response.density.first().localDay)
        assertEquals(9, response.density.first().localHour)
        assertEquals(3, response.density.last().appointmentCount)
    }

    @Test
    @DisplayName("BİLİNMEYEN durum çözümlemeyi düşürmez — o gün boş kalmaz")
    fun unknownStatusDoesNotBreakTheDay() {
        // Sunucuya yeni bir durum eklendiği gün, tek bir satır yüzünden günün tamamının
        // "bir şeyler ters gitti" göstermesi kabul edilemez.
        val response = decode("booking/calendar-day-unknown-status.json", CalendarResponse.serializer())

        val entry = response.appointments.single()
        assertEquals(AppointmentStatus.Unknown, entry.status)
        assertTrue(!entry.status.isTerminal, "Bilinmeyen durum kapanmış SAYILMAZ.")
        assertEquals("Bilinmeyen durum", entry.status.turkishName)
    }

    @Test
    @DisplayName("Hizmet özeti sortOrder sırasını izler, personel kimlikleri tekilleşir")
    fun serviceSummaryAndStaffIdsAreDerivedInOrder() {
        val now = Instant.parse("2026-09-07T06:00:00Z")
        val entry =
            CalendarEntry(
                id = "a",
                branchId = "b",
                customerId = "c",
                customerName = "Test",
                status = AppointmentStatus.Scheduled,
                startsAt = now,
                endsAt = now.plusSeconds(3600),
                services =
                    listOf(
                        line("2", "Maske", "staff-b", sortOrder = 1, now),
                        line("1", "Cilt bakımı", "staff-a", sortOrder = 0, now),
                        line("3", "Peeling", "staff-a", sortOrder = 2, now),
                    ),
            )

        assertEquals("Cilt bakımı + Maske + Peeling", entry.serviceSummary)
        assertEquals(listOf("staff-a", "staff-b"), entry.staffProfileIds)
    }

    @Test
    @DisplayName("SLOT_CONFLICT gövdesi `resourceId` / `from` / `to` ile çözülüyor")
    fun slotConflictUsesTheServerFieldNames() {
        // A0.4'te bu alanlar `staffProfileId` / `startsAt` / `endsAt` yazılmıştı
        // (dokümanın örneğinden). Hepsi nullable olduğu için çözümleme çökmüyor,
        // SESSİZCE boş kalıyordu: çakışma sayfası "dolu olan" satırını hiç çizemezdi.
        val problem = decode("booking/problem-slot-conflict.json", ProblemDetails.serializer())

        val conflict = problem.conflicts?.single()
        assertNotNull(conflict)
        assertEquals("staff", conflict?.resourceType)
        assertEquals("51a11000-0000-4000-8000-000000000001", conflict?.resourceId)
        assertNotNull(conflict?.from, "`from` çözülmezse çakışan aralık ekranda boş görünür.")
        assertNotNull(conflict?.to)

        val suggestion = problem.suggestions?.single()
        assertEquals(2, suggestion?.staffProfileIds?.size, "`staffProfileIds` bir LİSTEDİR.")
    }

    @Test
    @DisplayName("Bilinmeyen alanlar yok sayılır, eksik nullable alanlar null kalır")
    fun unknownFieldsAreIgnored() {
        val response = decode("booking/calendar-day-unknown-status.json", CalendarResponse.serializer())

        // Fixture bir `loyaltyTier` taşıyor: sunucu bir alan eklediğinde istemci kırılmaz.
        assertNull(response.appointments.single().notes)
        assertTrue(response.appointments.single().services.isEmpty())
    }

    private fun line(
        id: String,
        name: String,
        staff: String,
        sortOrder: Int,
        at: Instant,
    ) = CalendarEntryServiceLine(
        id = id,
        serviceId = "s-$id",
        serviceName = name,
        staffProfileId = staff,
        sortOrder = sortOrder,
        startsAt = at,
        endsAt = at.plusSeconds(1800),
    )
}
