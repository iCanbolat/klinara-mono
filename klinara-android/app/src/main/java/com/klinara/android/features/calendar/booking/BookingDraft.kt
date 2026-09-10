package com.klinara.android.features.calendar.booking

import com.klinara.android.services.booking.Appointment
import com.klinara.android.services.booking.AppointmentServiceInput
import com.klinara.android.services.booking.AvailabilitySlot
import com.klinara.android.services.booking.CreateAppointmentInput
import com.klinara.android.services.booking.RescheduleAppointmentInput
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.staff.StaffProfile

/**
 * Randevu taslağı — saf bir değer tipi.
 *
 * Compose'suz ve servis-suz olması bilinçli: geçerlilik kuralları ve **yan etkileri olan
 * mutasyonlar** burada yaşıyor ve tamamen birim testlenebiliyor. iOS'ta bu kuralların
 * her biri bir hata düzeltmesiydi; ekran koduna dağılsalardı biri sessizce kaybolurdu.
 */
data class BookingDraft(
    val branchId: String,
    /** Doluysa bu bir ERTELEME: müşteri ve hizmet dizilimi kilitli. */
    val rescheduling: Appointment? = null,
    val customerId: String? = null,
    /** **SIRA ANLAMLIDIR** — hizmetler gönderilen sırayla ardışık uygulanır. */
    val serviceIds: List<String> = emptyList(),
    val staffProfileId: String? = null,
    val slot: AvailabilitySlot? = null,
    val notes: String = "",
    val reason: String = "",
    /** `serviceId` → `customerPackageItemId` (A5.2'de gerçek seçim gelir). */
    val packageItemIds: Map<String, String> = emptyMap(),
) {
    val isRescheduling: Boolean get() = rescheduling != null

    /** Erteleme müşteriyi ve hizmetleri KİLİTLER; değişen yalnız saat. */
    val canEditLineup: Boolean get() = !isRescheduling

    /** Uygunluk sorgusu en az bir hizmet ister — süre ondan hesaplanıyor. */
    val canQueryAvailability: Boolean get() = serviceIds.isNotEmpty()

    val isValid: Boolean
        get() = customerId != null && serviceIds.isNotEmpty() && slot != null && staffProfileId != null

    // --- Yan etkileri olan mutasyonlar ---

    /**
     * Hizmeti ekler/çıkarır.
     *
     * Sırayı korur, çıkarırken paket bağını da siler ve **her hâlde slot'u düşürür**:
     * süre değişti, elde tutulan slot artık başka bir aralığa denk geliyor. Düşürmemek,
     * kullanıcının seçtiği saatin sessizce kaymasına yol açardı.
     */
    fun toggleService(serviceId: String): BookingDraft =
        if (serviceId in serviceIds) {
            copy(
                serviceIds = serviceIds - serviceId,
                packageItemIds = packageItemIds - serviceId,
                slot = null,
            )
        } else {
            copy(serviceIds = serviceIds + serviceId, slot = null)
        }

    /**
     * Müşteriyi seçer ve **paket bağlarını tümüyle temizler**: seans hakkı müşteriye
     * aittir, başka bir müşterinin hakkını taşımak bedava seans demek.
     */
    fun selectCustomer(id: String): BookingDraft =
        if (customerId == id) this else copy(customerId = id, packageItemIds = emptyMap())

    /** Personel değişince slot düşer — o personelin uygunluğu farklı. */
    fun selectStaff(id: String?): BookingDraft = copy(staffProfileId = id, slot = null)

    /**
     * Slot seçer.
     *
     * Seçili personel bu slotun adayları arasındaysa KORUNUR, değilse ilk adaya düşülür.
     * Korumamak, kullanıcının bilerek seçtiği personeli sessizce değiştirmek olurdu.
     */
    fun selectSlot(picked: AvailabilitySlot): BookingDraft =
        copy(
            slot = picked,
            staffProfileId =
                staffProfileId?.takeIf { it in picked.staffProfileIds } ?: picked.staffProfileIds.firstOrNull(),
        )

    // --- Türetilenler ---

    /** Müşterinin gördüğü süre. Tamponlar sunucunun işi. */
    fun visibleMinutes(services: List<ClinicService>): Int =
        serviceIds.sumOf { id -> services.firstOrNull { it.id == id }?.effective(branchId)?.durationMinutes ?: 0 }

    fun totalMinor(services: List<ClinicService>): Long =
        serviceIds.sumOf { id -> services.firstOrNull { it.id == id }?.effective(branchId)?.priceMinor ?: 0L }

    /**
     * Seçili hizmetlerin **hepsinde** yetkin, aktif personel.
     *
     * "Herhangi birinde yetkin" olsaydı, sunucu 422 `RESOURCE_UNAVAILABLE` ile
     * reddederdi — ve kullanıcı reddedilmeden önce bunu bilemezdi.
     */
    fun eligibleStaff(staff: List<StaffProfile>): List<StaffProfile> =
        staff.filter { profile ->
            profile.isActive && serviceIds.all { profile.isCompetent(it, branchId) }
        }

    // --- Kablo gövdeleri ---

    fun createInput(clock: BranchClock): CreateAppointmentInput? {
        val customer = customerId ?: return null
        val staff = staffProfileId ?: return null
        val picked = slot ?: return null
        if (serviceIds.isEmpty()) return null

        return CreateAppointmentInput(
            branchId = branchId,
            customerId = customer,
            startsAt = clock.wireValue(picked.startsAt),
            services = serviceIds.map { AppointmentServiceInput(it, staff, packageItemIds[it]) },
            notes = notes.trim().takeIf { it.isNotEmpty() },
        )
    }

    fun rescheduleInput(clock: BranchClock): RescheduleAppointmentInput? {
        val staff = staffProfileId ?: return null
        val picked = slot ?: return null
        if (serviceIds.isEmpty()) return null

        return RescheduleAppointmentInput(
            startsAt = clock.wireValue(picked.startsAt),
            services = serviceIds.map { AppointmentServiceInput(it, staff, packageItemIds[it]) },
            reason = reason.trim().takeIf { it.isNotEmpty() },
        )
    }

    companion object {
        /**
         * Erteleme taslağı.
         *
         * Mevcut **paket bağları KORUNUR**: korumazsak erteleme, müşterinin seans hakkını
         * sessizce çözer ve randevu ücretli hâle gelir.
         */
        fun rescheduling(appointment: Appointment): BookingDraft {
            val ordered = appointment.services.sortedBy { it.sortOrder }
            return BookingDraft(
                branchId = appointment.branchId,
                rescheduling = appointment,
                customerId = appointment.customerId,
                serviceIds = ordered.map { it.serviceId },
                staffProfileId = ordered.firstOrNull()?.staffProfileId,
                packageItemIds =
                    ordered.mapNotNull { line ->
                        line.customerPackageItemId?.let { line.serviceId to it }
                    }.toMap(),
            )
        }
    }
}
