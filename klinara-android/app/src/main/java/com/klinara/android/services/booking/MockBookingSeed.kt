package com.klinara.android.services.booking

import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.formatting.ClockTime
import com.klinara.android.services.formatting.VatRate
import com.klinara.android.services.mock.MockClock
import com.klinara.android.services.mock.MockDataScenario
import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.mock.MockIds
import java.time.Instant

/**
 * Mock takvim verisi.
 *
 * **Fixture değil, tohum.** Takvim "bugünü" göstermek zorunda; sabit tarihli bir JSON
 * yarın yanlış olurdu ve boş bir gün gibi görünürdü. `klinara-fixtures/booking/`
 * altındaki dosyalar ÇÖZÜMLEME SÖZLEŞMESİNİ çiviliyor (testler onları okur); bu tohum
 * ise ekranı sürüyor. İkisi ayrı iştir ve birbirinin yerine geçemez.
 *
 * Zaman çıpası [MockClock.reference] — şube diliminde bugün 23:30. Gün sonu bilerek:
 * "bugün" sınırıyla ilgili hatalar ancak orada yüzeye çıkar.
 */
object MockBookingSeed {
    /**
     * [scenario] için, [anchor]'ın gününü merkez alan randevular.
     *
     * Dün ve yarın da doldurulur: tarih şeridinin noktaları ve hafta ızgarası boş bir
     * hafta göstermesin. Yalnız bugünü tohumlamak, hafta görünümünü hiç sürülemez
     * yapardı.
     */
    fun entries(
        scenario: MockDataScenario,
        clock: BranchClock,
        anchor: Instant,
    ): List<CalendarEntry> {
        val templates =
            when (scenario) {
                MockDataScenario.EmptyDay -> emptyList()
                MockDataScenario.BusyDay -> BUSY_DAY
                MockDataScenario.ConflictHeavy -> CONFLICT_HEAVY
            }
        val today = clock.startOfDay(anchor)
        return templates.mapIndexed { index, template -> template.toEntry(index, clock, today) }
    }

    /**
     * Yoğunluk kovaları.
     *
     * Sunucu bunları **iptal ve gelmedi hariç** üretiyor ve **personel filtresine göre
     * daraltmıyor** (`calendar.repository.ts:loadDensity`). Mock aynı iki kuralı
     * uygular; aksi hâlde ekrandaki "şube geneli" notu mock'ta yalan olurdu.
     */
    fun density(
        entries: List<CalendarEntry>,
        clock: BranchClock,
    ): List<DensityBucket> =
        entries
            .filterNot { it.status.isTerminal }
            .groupingBy {
                clock.localDateString(it.startsAt) to clock.minutesFromMidnight(it.startsAt) / MINUTES_PER_HOUR
            }.eachCount()
            .map { (key, count) ->
                DensityBucket(localDay = key.first, localHour = key.second, appointmentCount = count)
            }
            .sortedWith(compareBy({ it.localDay }, { it.localHour }))

    private const val MINUTES_PER_HOUR = 60

    /**
     * Takvim satırını detay kaydına çevirir.
     *
     * Detay DTO'sunda olup takvim satırında olmayan alanlar burada üretiliyor. Tamponlar
     * **sıfır değil**: müşteri 14:00 görür, kaynak 13:55–15:10 tutulur. Sıfır tampon,
     * detay ekranındaki "görünen süre ≠ tutulan süre" dipnotunu hiç sürülemez yapardı ve
     * o dipnot canlıda gerçek bir kafa karışıklığını çözüyor.
     */
    fun detail(
        entry: CalendarEntry,
        clock: BranchClock,
    ): Appointment =
        Appointment(
            id = entry.id,
            tenantId = MockIds.TENANT_NISANTASI,
            branchId = entry.branchId,
            customerId = entry.customerId,
            status = entry.status,
            startsAt = entry.startsAt,
            endsAt = entry.endsAt,
            // Bir randevu online geldiyse ekranda ayrıca söyleniyor; tohumda birkaç
            // tanesi olsun ki o satır sürülebilsin.
            origin = if (entry.id.endsWith("3")) AppointmentOrigin.Online else AppointmentOrigin.Internal,
            notes = entry.notes,
            cancellationReason = "Müşteri erteleme istedi.".takeIf { entry.status == AppointmentStatus.Cancelled },
            version = entry.version,
            totalMinor = entry.totalMinor,
            createdAt = clock.adding(-DAYS_BEFORE_BOOKING, entry.startsAt),
            services =
                entry.services.map { line ->
                    AppointmentServiceLine(
                        id = line.id,
                        serviceId = line.serviceId,
                        staffProfileId = line.staffProfileId,
                        sortOrder = line.sortOrder,
                        startsAt = line.startsAt,
                        endsAt = line.endsAt,
                        durationMinutes = clock.minutes(line.startsAt, line.endsAt),
                        bufferBeforeMinutes = BUFFER_BEFORE_MINUTES,
                        bufferAfterMinutes = BUFFER_AFTER_MINUTES,
                        priceMinor = line.priceMinor,
                        vatRateBasisPoints = VatRate.TWENTY_PERCENT,
                    )
                },
        )

    private const val BUFFER_BEFORE_MINUTES = 5
    private const val BUFFER_AFTER_MINUTES = 10
    private const val DAYS_BEFORE_BOOKING = 9L

    /**
     * Şablonu okunur kılan kurucu.
     *
     * Konumsal bir demet ("0, 9, 0, 60, …") derleyiciyi memnun eder ama okuyucuyu
     * saymaya zorlar ve iki alanı yer değiştirmek sessizce geçer. Adlandırılmış
     * argümanlar hem o hatayı kapatır hem de saatleri birer "sihirli sayı" olmaktan
     * çıkarır — bir randevu tablosunda 9 ve 30 zaten kendi anlamlarıdır.
     */
    private fun appointment(
        dayOffset: Long,
        start: ClockTime,
        minutes: Int,
        staffProfileId: String,
        customerIndex: Int,
        services: List<ClinicService>,
        status: AppointmentStatus,
    ) = Template(dayOffset, start, minutes, staffProfileId, customerIndex, services, status)

    /**
     * `at("09:30")` — tabloda bir saat, iki ayrı sayı değil BİR saattir.
     *
     * Üretim çözümleyicisi ([ClockTime.parse]) kullanılıyor: tohumdaki bir yazım
     * hatası, sunucudan gelen bozuk bir saatle aynı yoldan yakalanır. Tablo derleme
     * zamanı sabit olduğu için hata ilk testte patlar, üretimde değil.
     */
    private fun at(time: String): ClockTime =
        requireNotNull(ClockTime.parse(time)) { "Tohumdaki saat okunamadı: $time" }

    /** Tipik bir klinik günü: dolu ama çakışmasız, iki kapanmış randevu dahil. */
    private val BUSY_DAY =
        listOf(
            appointment(
                dayOffset = -1, start = at("10:00"), minutes = 60,
                staffProfileId = MockIds.STAFF_DERYA, customerIndex = 0,
                services = listOf(Catalog.SKIN_CARE), status = AppointmentStatus.Completed,
            ),
            appointment(
                dayOffset = -1, start = at("14:30"), minutes = 45,
                staffProfileId = MockIds.STAFF_MERVE, customerIndex = 1,
                services = listOf(Catalog.LASER), status = AppointmentStatus.Completed,
            ),
            appointment(
                dayOffset = 0, start = at("09:00"), minutes = 60,
                staffProfileId = MockIds.STAFF_DERYA, customerIndex = 0,
                services = listOf(Catalog.SKIN_CARE), status = AppointmentStatus.Confirmed,
            ),
            appointment(
                dayOffset = 0, start = at("10:30"), minutes = 45,
                staffProfileId = MockIds.STAFF_MERVE, customerIndex = 2,
                services = listOf(Catalog.LASER), status = AppointmentStatus.Scheduled,
            ),
            appointment(
                dayOffset = 0, start = at("11:30"), minutes = 90,
                staffProfileId = MockIds.STAFF_DERYA, customerIndex = 3,
                services = listOf(Catalog.FILLER), status = AppointmentStatus.Arrived,
            ),
            appointment(
                dayOffset = 0, start = at("13:30"), minutes = 30,
                staffProfileId = MockIds.STAFF_ONUR, customerIndex = 4,
                services = listOf(Catalog.CHECKUP), status = AppointmentStatus.Completed,
            ),
            appointment(
                dayOffset = 0, start = at("14:30"), minutes = 75,
                staffProfileId = MockIds.STAFF_MERVE, customerIndex = 5,
                services = listOf(Catalog.SKIN_CARE, Catalog.MASK), status = AppointmentStatus.InProgress,
            ),
            appointment(
                dayOffset = 0, start = at("16:00"), minutes = 45,
                staffProfileId = MockIds.STAFF_DERYA, customerIndex = 6,
                services = listOf(Catalog.LASER), status = AppointmentStatus.Cancelled,
            ),
            appointment(
                dayOffset = 0, start = at("17:00"), minutes = 60,
                staffProfileId = MockIds.STAFF_ONUR, customerIndex = 7,
                services = listOf(Catalog.FILLER), status = AppointmentStatus.Scheduled,
            ),
            appointment(
                dayOffset = 0, start = at("18:30"), minutes = 30,
                staffProfileId = MockIds.STAFF_MERVE, customerIndex = 8,
                services = listOf(Catalog.CHECKUP), status = AppointmentStatus.NoShow,
            ),
            appointment(
                dayOffset = 1, start = at("09:30"), minutes = 60,
                staffProfileId = MockIds.STAFF_ONUR, customerIndex = 2,
                services = listOf(Catalog.CHECKUP), status = AppointmentStatus.Scheduled,
            ),
            appointment(
                dayOffset = 1, start = at("11:00"), minutes = 45,
                staffProfileId = MockIds.STAFF_DERYA, customerIndex = 5,
                services = listOf(Catalog.SKIN_CARE), status = AppointmentStatus.Scheduled,
            ),
            appointment(
                dayOffset = 2, start = at("15:00"), minutes = 90,
                staffProfileId = MockIds.STAFF_MERVE, customerIndex = 3,
                services = listOf(Catalog.LASER), status = AppointmentStatus.Scheduled,
            ),
        )

    /**
     * `CalendarBlockLayout`'un elle sürülebilir tek yolu.
     *
     * Üç ayrı küme biçimi var ve üçü de farklı bir kuralı sürüyor:
     * 1. **Tam örtüşme** (09:00 ×3) — eşit üç sütun.
     * 2. **Zincir** (11:00–13:00, 11:30, 12:00, 12:30) — dokunmayan uçlar da aynı
     *    kümede olduğu için 1/4 genişlik alır; "en az sütun" paketlemesi olsaydı
     *    yarım genişlik alırlardı. Kuralın gözle görülebildiği tek yer burası.
     * 3. **Dokunan aralık** (15:00–16:00 ve 16:00–17:00) — küme BÖLÜNÜR, ikisi de
     *    tam genişlik. `>=` ile `>` arasındaki fark ancak burada görünür.
     *
     * Üstüne 15:30'da bir iptal: terminal blok kümelemeye girmez, tam genişlik çizilir
     * ve aktif blokların sütun hesabını DEĞİŞTİRMEZ.
     */
    private val CONFLICT_HEAVY =
        listOf(
            appointment(
                dayOffset = 0, start = at("09:00"), minutes = 60,
                staffProfileId = MockIds.STAFF_DERYA, customerIndex = 0,
                services = listOf(Catalog.SKIN_CARE), status = AppointmentStatus.Confirmed,
            ),
            appointment(
                dayOffset = 0, start = at("09:00"), minutes = 60,
                staffProfileId = MockIds.STAFF_MERVE, customerIndex = 1,
                services = listOf(Catalog.LASER), status = AppointmentStatus.Scheduled,
            ),
            appointment(
                dayOffset = 0, start = at("09:00"), minutes = 60,
                staffProfileId = MockIds.STAFF_ONUR, customerIndex = 2,
                services = listOf(Catalog.CHECKUP), status = AppointmentStatus.Arrived,
            ),
            appointment(
                dayOffset = 0, start = at("11:00"), minutes = 120,
                staffProfileId = MockIds.STAFF_DERYA, customerIndex = 3,
                services = listOf(Catalog.FILLER), status = AppointmentStatus.Confirmed,
            ),
            appointment(
                dayOffset = 0, start = at("11:30"), minutes = 30,
                staffProfileId = MockIds.STAFF_MERVE, customerIndex = 4,
                services = listOf(Catalog.CHECKUP), status = AppointmentStatus.Scheduled,
            ),
            appointment(
                dayOffset = 0, start = at("12:00"), minutes = 30,
                staffProfileId = MockIds.STAFF_ONUR, customerIndex = 5,
                services = listOf(Catalog.CHECKUP), status = AppointmentStatus.Scheduled,
            ),
            appointment(
                dayOffset = 0, start = at("12:30"), minutes = 60,
                staffProfileId = MockIds.STAFF_MERVE, customerIndex = 6,
                services = listOf(Catalog.SKIN_CARE), status = AppointmentStatus.Scheduled,
            ),
            appointment(
                dayOffset = 0, start = at("15:00"), minutes = 60,
                staffProfileId = MockIds.STAFF_DERYA, customerIndex = 7,
                services = listOf(Catalog.LASER), status = AppointmentStatus.Confirmed,
            ),
            appointment(
                dayOffset = 0, start = at("15:30"), minutes = 30,
                staffProfileId = MockIds.STAFF_ONUR, customerIndex = 8,
                services = listOf(Catalog.CHECKUP), status = AppointmentStatus.Cancelled,
            ),
            appointment(
                dayOffset = 0, start = at("16:00"), minutes = 60,
                staffProfileId = MockIds.STAFF_MERVE, customerIndex = 9,
                services = listOf(Catalog.MASK), status = AppointmentStatus.Scheduled,
            ),
            appointment(
                dayOffset = 1, start = at("10:00"), minutes = 60,
                staffProfileId = MockIds.STAFF_DERYA, customerIndex = 1,
                services = listOf(Catalog.SKIN_CARE), status = AppointmentStatus.Scheduled,
            ),
            appointment(
                dayOffset = 1, start = at("10:15"), minutes = 60,
                staffProfileId = MockIds.STAFF_MERVE, customerIndex = 2,
                services = listOf(Catalog.LASER), status = AppointmentStatus.Scheduled,
            ),
        )

    /**
     * Tohumun hizmetleri — ad ve fiyat [MockCatalogService.ALL]'dan TÜRETİLİR (A7.1).
     *
     * A3.1'den beri burada özel bir kopya duruyordu; katalog tohumu değişince takvim
     * satırındaki ad ile rezervasyon formundaki ad ayrışırdı.
     */
    private object Catalog {
        val SKIN_CARE = seed(MockIds.SERVICE_SKIN_CARE)
        val LASER = seed(MockIds.SERVICE_LASER)
        val FILLER = seed(MockIds.SERVICE_FILLER)
        val CHECKUP = seed(MockIds.SERVICE_CHECKUP)
        val MASK = seed(MockIds.SERVICE_MASK)

        private fun seed(id: String): ClinicService = MockCatalogService.ALL.first { it.id == id }
    }

    private data class Template(
        val dayOffset: Long,
        val start: ClockTime,
        val minutes: Int,
        val staffProfileId: String,
        val customerIndex: Int,
        val services: List<ClinicService>,
        val status: AppointmentStatus,
    ) {
        fun toEntry(
            index: Int,
            clock: BranchClock,
            today: Instant,
        ): CalendarEntry {
            val day = clock.adding(dayOffset, today)
            val startsAt = clock.date(day, start)
            val endsAt = clock.addingMinutes(minutes.toLong(), startsAt)
            // Müşteri tablosu PAYLAŞILAN: `MockCustomerService` aynı satırları okuyor.
            // Ayrı kopyalar, detay ekranında takvimdekinden başka bir ad göstermeye
            // kadar giderdi.
            val customer = MockCustomers.at(customerIndex)

            // Hizmetler ARDIŞIK uygulanır: süre eşit bölünür ve satırlar uç uca gelir.
            val slice = minutes / services.size
            val lines =
                services.mapIndexed { order, service ->
                    val lineStart = clock.addingMinutes((order.toLong() * slice), startsAt)
                    CalendarEntryServiceLine(
                        id = id("5717", index * SERVICE_ID_STRIDE + order),
                        serviceId = service.id,
                        serviceName = service.name,
                        staffProfileId = staffProfileId,
                        sortOrder = order,
                        startsAt = lineStart,
                        endsAt = clock.addingMinutes(slice.toLong(), lineStart),
                        priceMinor = service.priceMinor,
                    )
                }

            return CalendarEntry(
                id = id("a99a", index),
                branchId = MockIds.BRANCH_NISANTASI,
                customerId = customer.id,
                customerName = customer.fullName,
                customerPhone = customer.phone,
                status = status,
                startsAt = startsAt,
                endsAt = endsAt,
                notes = null,
                version = 1,
                totalMinor = services.sumOf { it.priceMinor },
                services = lines,
            )
        }

        private fun id(
            prefix: String,
            index: Int,
        ): String = "$prefix" + "0000-0000-4000-8000-%012d".format(index + 1)

        private companion object {
            /** Satır kimlikleri randevular arasında çakışmasın diye. */
            const val SERVICE_ID_STRIDE = 10
        }
    }
}
