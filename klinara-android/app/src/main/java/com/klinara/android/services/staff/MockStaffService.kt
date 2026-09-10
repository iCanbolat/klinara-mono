package com.klinara.android.services.staff

import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.delay
import kotlin.random.Random

/**
 * Mock personel listesi.
 *
 * Kimlikler [MockIds]'ten geliyor; `MockBookingSeed` aynı sabitlere atıfta bulunuyor.
 * Ayrı tohumlanmış kopyalar, var olmayan bir personele bağlı randevu üretirdi.
 *
 * Üç personel bilerek: iki tanesi çakışma göstermeye yetmez, dördüncüsü filtre
 * çiplerini `fontScale 2.0`'da taşırır ve o taşma gerçek bir tasarım sorusu değil.
 */
class MockStaffService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
) : StaffService {
    /** Ağ hatası senaryosunda personel de düşsün diye; container kurarken verilir. */
    var failing: Boolean = false

    override suspend fun list(): List<StaffProfile> {
        simulateLatency()
        if (failing) throw ApiError.Network()
        return ALL
    }

    private suspend fun simulateLatency() {
        if (!latencyEnabled) return
        delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
    }

    companion object {
        /**
         * Renkler marka paletinden TÜREMEZ: takvimde personeli ayırt etmek için
         * birbirinden uzak tonlar gerekiyor ve `sage` ailesi bunu veremez. Rozet ve
         * düğme renkleri hâlâ token'lardan gelir; bu üç hex yalnız birer VERİ değeri
         * (sunucu `calendarColor` alanında aynısını gönderiyor), tasarım kararı değil.
         */
        val ALL: List<StaffProfile> =
            listOf(
                StaffProfile(
                    id = MockIds.STAFF_DERYA,
                    userId = MockIds.USER_MANAGER,
                    userFullName = "Derya Aksoy",
                    primaryBranchId = MockIds.BRANCH_NISANTASI,
                    title = "Cilt bakım uzmanı",
                    calendarColor = "#1A6A7A",
                    services = skills(MockIds.SERVICE_SKIN_CARE, MockIds.SERVICE_MASK, MockIds.SERVICE_FILLER),
                ),
                StaffProfile(
                    id = MockIds.STAFF_MERVE,
                    userId = MockIds.USER_MANAGER,
                    userFullName = "Merve Tunç",
                    primaryBranchId = MockIds.BRANCH_NISANTASI,
                    title = "Lazer uygulayıcı",
                    calendarColor = "#8A5A2B",
                    services = skills(MockIds.SERVICE_LASER, MockIds.SERVICE_SKIN_CARE, MockIds.SERVICE_MASK),
                ),
                StaffProfile(
                    id = MockIds.STAFF_ONUR,
                    userId = MockIds.USER_MANAGER,
                    userFullName = "Onur Bayrak",
                    primaryBranchId = MockIds.BRANCH_NISANTASI,
                    title = "Estetisyen",
                    calendarColor = "#6B4E9B",
                    // Pasif değil ama bir hizmette yetkin DEĞİL: A3.4'ün "yetkin
                    // personel" süzgeci elle sürülebilsin diye.
                    services = skills(MockIds.SERVICE_CHECKUP, MockIds.SERVICE_FILLER),
                ),
            )

        private const val MIN_LATENCY_MILLIS = 120L
        private const val MAX_LATENCY_MILLIS = 400L

        private fun skills(vararg serviceIds: String): List<StaffServiceSkill> =
            serviceIds.mapIndexed { index, serviceId ->
                StaffServiceSkill(
                    id = "5c111000-0000-4000-8000-%012d".format(index + 1),
                    serviceId = serviceId,
                    branchId = null,
                )
            }
    }
}
