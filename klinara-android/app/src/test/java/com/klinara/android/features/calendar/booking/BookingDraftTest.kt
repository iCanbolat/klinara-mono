package com.klinara.android.features.calendar.booking

import com.klinara.android.services.booking.Appointment
import com.klinara.android.services.booking.AppointmentServiceLine
import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.booking.AvailabilitySlot
import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.staff.MockStaffService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * Taslak kuralları.
 *
 * iOS'ta bu kuralların her biri bir hata düzeltmesiydi; burada saf bir değer tipinde
 * yaşıyorlar ve her biri kendi testine sahip. Ekran koduna dağılsalardı biri sessizce
 * kaybolurdu ve kaybı ancak bir müşteri bedava seans alınca fark edilirdi.
 */
class BookingDraftTest {
    private val clock = BranchClock("Europe/Istanbul")
    private val branch = MockIds.BRANCH_NISANTASI
    private val slot =
        AvailabilitySlot(
            startsAt = Instant.parse("2026-09-10T06:00:00Z"),
            endsAt = Instant.parse("2026-09-10T07:00:00Z"),
            staffProfileIds = listOf(MockIds.STAFF_DERYA, MockIds.STAFF_MERVE),
        )

    private fun draft() = BookingDraft(branchId = branch)

    // --- Geçerlilik ---

    @Test
    @DisplayName("Dört alanın dördü de dolmadan kaydedilemez")
    fun allFourFieldsAreRequired() {
        assertTrue(!draft().isValid)
        assertTrue(!draft().selectCustomer("c").isValid)
        assertTrue(!draft().selectCustomer("c").toggleService("s").isValid)

        val complete = draft().selectCustomer("c").toggleService("s").selectSlot(slot)
        assertTrue(complete.isValid, "Slot seçimi personeli de dolduruyor.")
    }

    @Test
    @DisplayName("Hizmet seçilmeden uygunluk SORULMAZ — süre bilinmiyor")
    fun availabilityNeedsAtLeastOneService() {
        assertTrue(!draft().canQueryAvailability)
        assertTrue(draft().toggleService("s").canQueryAvailability)
    }

    // --- Yan etkiler ---

    @Test
    @DisplayName("Hizmet değişince SLOT DÜŞER — süre değişti, saat kaydı geçersiz")
    fun changingServicesDropsTheSlot() {
        val withSlot = draft().toggleService("a").selectSlot(slot)
        assertNotNull(withSlot.slot)

        assertNull(withSlot.toggleService("b").slot, "Hizmet eklemek süreyi uzatır.")
        assertNull(withSlot.toggleService("a").slot, "Hizmet çıkarmak süreyi kısaltır.")
    }

    @Test
    @DisplayName("Hizmet sırası korunur — sunucuya AYNEN gidiyor")
    fun serviceOrderIsPreserved() {
        val subject = draft().toggleService("c").toggleService("a").toggleService("b")

        assertEquals(listOf("c", "a", "b"), subject.serviceIds)
    }

    @Test
    @DisplayName("Hizmet çıkarınca paket bağı da silinir")
    fun removingAServiceClearsItsPackageBinding() {
        val subject =
            draft()
                .toggleService("a")
                .copy(packageItemIds = mapOf("a" to "item-1", "b" to "item-2"))

        assertEquals(mapOf("b" to "item-2"), subject.toggleService("a").packageItemIds)
    }

    @Test
    @DisplayName("Müşteri değişince paket bağları TÜMÜYLE temizlenir")
    fun changingCustomerClearsAllPackageBindings() {
        // Seans hakkı müşteriye aittir; başka bir müşterinin hakkını taşımak
        // bedava seans demek.
        val subject =
            draft().selectCustomer("ayşe").copy(packageItemIds = mapOf("a" to "item-1"))

        assertTrue(subject.selectCustomer("zeynep").packageItemIds.isEmpty())
    }

    @Test
    @DisplayName("Aynı müşteriye tekrar dokunmak paket bağlarını KORUR")
    fun reselectingTheSameCustomerKeepsBindings() {
        val subject = draft().selectCustomer("ayşe").copy(packageItemIds = mapOf("a" to "item-1"))

        assertEquals(mapOf("a" to "item-1"), subject.selectCustomer("ayşe").packageItemIds)
    }

    @Test
    @DisplayName("Personel değişince slot düşer")
    fun changingStaffDropsTheSlot() {
        val subject = draft().toggleService("a").selectSlot(slot)

        assertNull(subject.selectStaff(MockIds.STAFF_ONUR).slot)
    }

    @Test
    @DisplayName("Slot seçimi seçili personeli KORUR — adaylar arasındaysa")
    fun slotSelectionKeepsACompatibleStaff() {
        val subject = draft().selectStaff(MockIds.STAFF_MERVE).selectSlot(slot)

        assertEquals(MockIds.STAFF_MERVE, subject.staffProfileId)
    }

    @Test
    @DisplayName("Slot seçili personeli veremiyorsa ilk adaya düşülür")
    fun slotSelectionFallsBackWhenStaffCannotServe() {
        val subject = draft().selectStaff(MockIds.STAFF_ONUR).selectSlot(slot)

        assertEquals(MockIds.STAFF_DERYA, subject.staffProfileId)
    }

    // --- Erteleme ---

    @Test
    @DisplayName("Erteleme müşteriyi ve hizmet dizilimini KİLİTLER")
    fun rescheduleLocksTheLineup() {
        val subject = BookingDraft.rescheduling(appointment())

        assertTrue(subject.isRescheduling)
        assertTrue(!subject.canEditLineup)
        assertEquals("müşteri-1", subject.customerId)
        assertEquals(listOf("hizmet-a", "hizmet-b"), subject.serviceIds, "Sıra `sortOrder`'dan gelir.")
    }

    @Test
    @DisplayName("Erteleme mevcut paket bağlarını KORUR")
    fun rescheduleKeepsPackageBindings() {
        // Korumazsak erteleme, müşterinin seans hakkını sessizce çözer ve randevu
        // ücretli hâle gelir.
        val subject = BookingDraft.rescheduling(appointment())

        assertEquals(mapOf("hizmet-a" to "paket-1"), subject.packageItemIds)
    }

    @Test
    @DisplayName("Erteleme gövdesi sebep taşır, oluşturma gövdesi not")
    fun wireBodiesCarryTheRightFields() {
        val rescheduleDraft =
            BookingDraft.rescheduling(appointment()).selectSlot(slot).copy(reason = "  Müşteri talebi  ")
        val body = rescheduleDraft.rescheduleInput(clock)

        assertEquals("Müşteri talebi", body?.reason, "Kenar boşlukları kırpılmalı.")
        assertEquals(2, body?.services?.size)

        val createDraft =
            draft().selectCustomer("c").toggleService("a").selectSlot(slot).copy(notes = "   ")
        // Yalnız boşluktan ibaret bir not, not değildir.
        assertNull(createDraft.createInput(clock)?.notes)
    }

    @Test
    @DisplayName("Eksik taslak gövde ÜRETMEZ — yarım istek gitmez")
    fun incompleteDraftProducesNoBody() {
        assertNull(draft().createInput(clock))
        assertNull(draft().selectCustomer("c").createInput(clock))
    }

    // --- Türetilenler ---

    @Test
    @DisplayName("Yetkin personel: hizmetlerin HEPSİNİ verebilenler")
    fun eligibleStaffMustCoverEveryService() {
        val staff = MockStaffService.ALL
        // Onur cilt bakımı vermiyor; Derya ve Merve veriyor.
        val skinOnly = draft().toggleService(MockIds.SERVICE_SKIN_CARE)
        assertEquals(
            listOf("Derya Aksoy", "Merve Tunç"),
            skinOnly.eligibleStaff(staff).map { it.userFullName },
        )

        // Cilt bakımı + kontrol: hiçbiri ikisini birden vermiyor.
        val both = skinOnly.toggleService(MockIds.SERVICE_CHECKUP)
        assertTrue(
            both.eligibleStaff(staff).isEmpty(),
            "\"Herhangi birinde yetkin\" olsaydı sunucu 422 ile reddederdi ve kullanıcı " +
                "bunu ancak reddedildikten sonra öğrenirdi.",
        )
    }

    @Test
    @DisplayName("Süre ve tutar şubenin geçerli değerinden hesaplanır")
    fun totalsUseTheBranchEffectiveValues() {
        val services = MockCatalogService.ALL
        val subject =
            draft().toggleService(MockIds.SERVICE_SKIN_CARE).toggleService(MockIds.SERVICE_LASER)

        assertEquals(105, subject.visibleMinutes(services), "60 + 45")
        assertEquals(235_000L, subject.totalMinor(services), "90.000 + 145.000 kuruş")
    }

    private fun appointment(): Appointment {
        val start = Instant.parse("2026-09-10T06:00:00Z")
        return Appointment(
            id = "randevu-1",
            tenantId = MockIds.TENANT_NISANTASI,
            branchId = branch,
            customerId = "müşteri-1",
            status = AppointmentStatus.Scheduled,
            startsAt = start,
            endsAt = start.plusSeconds(3600),
            createdAt = start,
            version = 3,
            services =
                listOf(
                    line("hizmet-b", MockIds.STAFF_MERVE, sortOrder = 1, at = start, packageItemId = null),
                    line("hizmet-a", MockIds.STAFF_DERYA, sortOrder = 0, at = start, packageItemId = "paket-1"),
                ),
        )
    }

    private fun line(
        serviceId: String,
        staffProfileId: String,
        sortOrder: Int,
        at: Instant,
        packageItemId: String?,
    ) = AppointmentServiceLine(
        id = "satır-$serviceId",
        serviceId = serviceId,
        staffProfileId = staffProfileId,
        sortOrder = sortOrder,
        startsAt = at,
        endsAt = at.plusSeconds(1800),
        durationMinutes = 30,
        customerPackageItemId = packageItemId,
    )
}
