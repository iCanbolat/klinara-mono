package com.klinara.android.features.calendar.booking

import com.klinara.android.services.booking.AvailabilityDay
import com.klinara.android.services.booking.AvailabilityDayStatus
import com.klinara.android.services.booking.AvailabilitySlot
import com.klinara.android.services.formatting.BranchClock

/**
 * Uygunluk yanıtının ekrana çevrilmesi — saf mantık, Compose'dan ayrı ki test edilebilsin.
 *
 * Web `lib/calendar/availability.ts` ve iOS `BookingAvailabilityPresentation` aynı kuralları
 * ve aynı metinleri taşıyor; birinde değişen metin diğer ikisine de işlenmeli.
 */
object AvailabilityPresentation {
    enum class Period(val title: String) {
        Morning("Sabah"),
        Afternoon("Öğleden sonra"),
        Evening("Akşam"),
        ;

        companion object {
            fun of(hour: Int): Period =
                when {
                    hour < 12 -> Morning
                    hour < 17 -> Afternoon
                    else -> Evening
                }
        }
    }

    data class SlotGroup(
        val period: Period,
        val slots: List<AvailabilitySlot>,
    )

    /** Slotları sabah / öğleden sonra / akşam gruplarına böler; saat ŞUBE diliminde okunur. */
    fun group(
        slots: List<AvailabilitySlot>,
        clock: BranchClock,
    ): List<SlotGroup> {
        val groups = mutableListOf<SlotGroup>()
        for (slot in slots) {
            val period = Period.of(clock.hour(slot.startsAt))
            val last = groups.lastOrNull()
            if (last?.period == period) {
                groups[groups.lastIndex] = last.copy(slots = last.slots + slot)
            } else {
                groups += SlotGroup(period, listOf(slot))
            }
        }
        return groups
    }

    data class Notice(
        /** `true`: gün kuralı (kapalı, tatil…); `false`: açık ama dolu. */
        val isDayRule: Boolean,
        val title: String,
        val detail: String,
        /** "Sonraki gün" önerilsin mi — pencere dışında anlamsız. */
        val suggestsNextDay: Boolean,
    )

    /** Slot listesi boşken NEDEN boş olduğu. `day` yoksa (eski API) gün dolu kabul edilir. */
    fun emptyNotice(day: AvailabilityDay?): Notice =
        when (day?.status) {
            AvailabilityDayStatus.Holiday ->
                Notice(
                    isDayRule = true,
                    title = day.holidayName?.let { "Tatil · $it" } ?: "Klinik bu gün tatil",
                    detail = "Bu gün randevu alınmıyor. Başka bir gün seçin.",
                    suggestsNextDay = true,
                )
            AvailabilityDayStatus.Closed ->
                Notice(
                    isDayRule = true,
                    title = "Şube bu gün kapalı",
                    detail = "Haftalık çalışma saatlerinde bu gün kapalı. Başka bir gün seçin.",
                    suggestsNextDay = true,
                )
            AvailabilityDayStatus.Past ->
                Notice(
                    isDayRule = true,
                    title = "Bu günün çalışma saatleri geçti",
                    detail = "İleri bir tarih seçin.",
                    suggestsNextDay = true,
                )
            AvailabilityDayStatus.BeyondWindow ->
                Notice(
                    isDayRule = true,
                    title = "Rezervasyon penceresinin dışında",
                    detail = "Bu tarih için henüz randevu açılmadı. Daha yakın bir gün seçin.",
                    suggestsNextDay = false,
                )
            else ->
                Notice(
                    isDayRule = false,
                    title = "Bu gün boş saat kalmadı",
                    detail = "Tüm saatler dolu. Başka bir gün ya da personel deneyin.",
                    suggestsNextDay = true,
                )
        }

    /** Açık günün ek notu: yarım gün tatilde daraltılmış saatler. */
    fun openDayNote(day: AvailabilityDay?): String? {
        if (day?.status != AvailabilityDayStatus.Open) return null
        val name = day.holidayName ?: return null
        val hours = if (day.opensAt != null && day.closesAt != null) " ${day.opensAt}–${day.closesAt}" else ""
        return "$name · kısaltılmış çalışma saatleri$hours"
    }
}
