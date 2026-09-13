package com.klinara.android.services.reports

import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.crm.CustomerSource
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.staff.MockStaffService
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Rapor mock'unun ham verisi: günlük vardiyalar ve ziyaretler — **deterministik**, tohumdan türer.
 *
 * iOS mock'u dönemden bağımsız sabit bir rapor döndürüyordu; dönem kaydırıldığında ekran hiç
 * değişmiyor, karşılaştırma ve `null` delta hiç sürülemiyordu. Burada her gün, personel ve hizmet
 * katalog/personel tohumundan (ad, süre, fiyat, yetkinlik) ve günün sırasından türüyor; aynı gün
 * her çağrıda aynı sayıyı verir.
 *
 * Bu sunucudaki SQL'in ikinci bir uygulaması DEĞİL: yalnız "bir rapor neyi toplar" sorusunun
 * şekli taklit ediliyor (ziyaret grain'i, yarı açık aralık, iptal dakikası dolu sayılmaz). İstemci
 * bu sayıların hiçbirini hesaplamıyor — mock sunucunun yerinde duruyor.
 *
 * Klinik [OPENED] tarihinde açıldı: ondan önceki dönemler boş, yani "önceki dönem sıfır → delta
 * `null`" dalı açılışı içeren bir dönemle sürülebilir. Bodrum şubesinde personel yok; şube
 * değiştirildiğinde boş rapor ekranı görünür.
 */
internal class MockReportsData(
    private val now: () -> Instant,
    private val zone: ZoneId = BranchClock(null).zone,
) {
    enum class Status { Booked, Completed, NoShow, Cancelled }

    data class Shift(
        val date: LocalDate,
        val staffId: String,
        val staffName: String,
        val minutes: Int,
    ) {
        val branchId: String get() = MockIds.BRANCH_NISANTASI
    }

    data class Visit(
        val date: LocalDate,
        val staffId: String,
        val staffName: String,
        val serviceId: String,
        val serviceName: String,
        /** Sentetik müşteri havuzunun sırası — kimlik yanıta HİÇ çıkmaz. */
        val customer: Int,
        val status: Status,
        val isOnline: Boolean,
        val minutes: Int,
        val priceMinor: Long,
        /** Tahsil edilmemiş kalem 0; ödeme yöntemi yalnız tahsil edilende. */
        val collectedMinor: Long,
        val method: String?,
        val packageName: String?,
    ) {
        val branchId: String get() = MockIds.BRANCH_NISANTASI
    }

    private val staff = MockStaffService.ALL.filter { it.primaryBranchId == MockIds.BRANCH_NISANTASI }
    private val services = MockCatalogService.ALL.associateBy { it.id }

    fun localDate(instant: Instant): LocalDate = instant.atZone(zone).toLocalDate()

    /** `[from, to)` içindeki yerel günler — üst sınırın günü dahil DEĞİL. */
    fun days(period: ReportPeriod): List<LocalDate> {
        val first = localDate(period.from)
        val end = localDate(period.to)
        return generateSequence(first) { it.plusDays(1) }.takeWhile { it.isBefore(end) }.toList()
    }

    fun shifts(
        period: ReportPeriod,
        branchId: String?,
        staffId: String?,
    ): List<Shift> =
        days(period).filter(::isOpen).flatMap { day ->
            staff
                .filter { staffId == null || it.id == staffId }
                .map { Shift(day, it.id, it.userFullName, SHIFT_MINUTES) }
                .filter { branchId == null || it.branchId == branchId }
        }

    fun visits(
        period: ReportPeriod,
        branchId: String?,
        staffId: String?,
    ): List<Visit> =
        visitsOn(days(period)).filter {
            (branchId == null || it.branchId == branchId) && (staffId == null || it.staffId == staffId)
        }

    /** Açılıştan bugüne TÜM ziyaretler — kazanımın "ilk ziyaret" sorusu pencerenin dışına bakar. */
    fun history(branchId: String?): List<Visit> {
        val today = localDate(now())
        val days = generateSequence(OPENED) { it.plusDays(1) }.takeWhile { !it.isAfter(today) }.toList()
        return visitsOn(days).filter { branchId == null || it.branchId == branchId }
    }

    fun source(customer: Int): String? = SOURCES[customer % SOURCES.size]?.wire

    private fun visitsOn(days: List<LocalDate>): List<Visit> {
        val today = localDate(now())
        return days.filter(::isOpen).flatMap { day ->
            val index = (day.toEpochDay() - OPENED.toEpochDay()).toInt()
            staff.flatMapIndexed { position, profile ->
                val skills = profile.services.mapNotNull { services[it.serviceId] }
                val count = (index * DAY_STRIDE + position * COUNT_STAFF_STRIDE + 1) % MAX_VISITS_PER_DAY
                (0 until count).map { slot ->
                    val service = skills[(index + slot) % skills.size]
                    val seed = index + position + slot
                    val status = status(day, today, seed)
                    val paid = status == Status.Completed && seed % UNPAID_EVERY != 0
                    Visit(
                        date = day,
                        staffId = profile.id,
                        staffName = profile.userFullName,
                        serviceId = service.id,
                        serviceName = service.name,
                        // Havuz her gün bir büyüyor: yeni müşteri dönem boyunca gelmeye devam etsin.
                        customer = (index * CUSTOMER_STRIDE + position * STAFF_STRIDE + slot) % (CUSTOMER_BASE + index),
                        status = status,
                        isOnline = (index + slot) % ONLINE_EVERY == 0,
                        minutes = service.durationMinutes,
                        priceMinor = service.priceMinor,
                        collectedMinor = if (paid) service.priceMinor else 0,
                        method = if (paid) METHODS[seed % METHODS.size] else null,
                        packageName = PACKAGE_NAME.takeIf { service.id == MockIds.SERVICE_LASER },
                    )
                }
            }
        }
    }

    private fun status(
        day: LocalDate,
        today: LocalDate,
        seed: Int,
    ): Status =
        when {
            seed % CANCEL_EVERY == CANCEL_REMAINDER -> Status.Cancelled
            !day.isBefore(today) -> Status.Booked
            seed % NO_SHOW_EVERY == 0 -> Status.NoShow
            else -> Status.Completed
        }

    private fun isOpen(day: LocalDate): Boolean = !day.isBefore(OPENED) && day.dayOfWeek != DayOfWeek.SUNDAY

    companion object {
        val OPENED: LocalDate = LocalDate.of(2026, 1, 5)

        /** 09:00–18:00. */
        const val SHIFT_MINUTES = 540
        const val PACKAGE_NAME = "Lazer 6 seans"

        private const val MAX_VISITS_PER_DAY = 5
        private const val DAY_STRIDE = 3
        private const val COUNT_STAFF_STRIDE = 2
        private const val STAFF_STRIDE = 5
        private const val CUSTOMER_STRIDE = 7
        private const val CUSTOMER_BASE = 20
        private const val UNPAID_EVERY = 6
        private const val ONLINE_EVERY = 3
        private const val NO_SHOW_EVERY = 9
        private const val CANCEL_EVERY = 13
        private const val CANCEL_REMAINDER = 5

        private val METHODS = listOf("card", "cash", "card", "bank_transfer")

        /** `null` bilerek var: kaynağı girilmemiş müşteri "Belirtilmemiş" satırı olmalı. */
        private val SOURCES =
            listOf(
                CustomerSource.Instagram,
                CustomerSource.Referral,
                CustomerSource.WalkIn,
                null,
                CustomerSource.Google,
                CustomerSource.Instagram,
                CustomerSource.WhatsApp,
            )
    }
}
