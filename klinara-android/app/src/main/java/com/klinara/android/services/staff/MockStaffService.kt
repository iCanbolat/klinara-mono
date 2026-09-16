package com.klinara.android.services.staff

import com.klinara.android.services.auth.UserProfile
import com.klinara.android.services.catalog.ClinicService
import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.random.Random

/**
 * Mock personel — A7.2'den beri **yazılabilir** bir tablo.
 *
 * Kimlikler [MockIds]'ten geliyor; `MockBookingSeed` aynı sabitlere atıfta bulunuyor.
 * Ayrı tohumlanmış kopyalar, var olmayan bir personele bağlı randevu üretirdi.
 *
 * Üç personel bilerek: iki tanesi çakışma göstermeye yetmez, dördüncüsü filtre
 * çiplerini `fontScale 2.0`'da taşırır ve o taşma gerçek bir tasarım sorusu değil.
 *
 * Sunucunun kurallarını taklit eder: aynı kullanıcıya ikinci profil 409, bilinmeyen
 * kullanıcı/hizmet 404, pasif hizmete yetkinlik 409 (`K0002`), bir istekte aynı
 * (hizmet, şube) çifti 400. Randevu motoru tabloyu [snapshotProfiles] ile okur: pasife
 * alınan personel ve kaldırılan yetkinlik slot adaylarından düşer.
 */
class MockStaffService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
    /** Kullanıcı tablosu — profil oluştururken ad/e-posta buradan; bilinmeyen kullanıcı 404. */
    private val users: () -> List<UserProfile> = { MockUsersService.ALL },
    /** Katalog tablosu — pasif ya da bilinmeyen hizmete yetkinlik reddedilir. */
    private val catalog: () -> List<ClinicService> = { MockCatalogService.ALL },
) : StaffService {
    /** Ağ hatası senaryosunda personel de düşsün diye; container kurarken verilir. */
    var failing: Boolean = false

    private val records: MutableList<StaffProfile> = ALL.toMutableList()
    private var idCounter: Int = 0

    /** Diğer mock'lar için askıya almadan okunur kopya. */
    fun snapshotProfiles(): List<StaffProfile> = records.toList()

    override suspend fun list(branchId: String?): List<StaffProfile> {
        settle()
        return records.filter { branchId == null || it.worksIn(branchId) }.sortedBy { it.userFullName }
    }

    override suspend fun profile(id: String): StaffProfile {
        settle()
        return find(id)
    }

    override suspend fun create(input: CreateStaffProfileInput): StaffProfile {
        settle()
        val user = users().firstOrNull { it.id == input.userId } ?: throw MockErrors.notFound("Kullanıcı")
        if (records.any { it.userId == input.userId }) {
            throw MockErrors.conflict("Çakışma", "Bu kullanıcı için personel profili zaten var")
        }
        idCounter += 1
        val created =
            StaffProfile(
                id = "51a11000-0000-4000-8000-%012d".format(NEW_ID_BASE + idCounter),
                tenantId = MockIds.TENANT_NISANTASI,
                userId = user.id,
                userFullName = user.fullName,
                userEmail = user.email,
                primaryBranchId = input.primaryBranchId,
                title = input.title,
                specialties = input.specialties,
                calendarColor = input.calendarColor,
                bio = input.bio,
                isVisibleOnline = input.isVisibleOnline ?: true,
                isActive = input.isActive ?: true,
                createdAt = Instant.now(),
            )
        records += created
        return created
    }

    override suspend fun update(
        id: String,
        input: UpdateStaffProfileInput,
    ): StaffProfile {
        settle()
        val old = find(id)
        val updated =
            old.copy(
                primaryBranchId = input.primaryBranchId.resolve(old.primaryBranchId),
                title = input.title.resolve(old.title),
                specialties = input.specialties ?: old.specialties,
                calendarColor = input.calendarColor.resolve(old.calendarColor),
                bio = input.bio.resolve(old.bio),
                isVisibleOnline = input.isVisibleOnline ?: old.isVisibleOnline,
                isActive = input.isActive ?: old.isActive,
            )
        records[records.indexOf(old)] = updated
        return updated
    }

    override suspend fun replaceSkills(
        id: String,
        input: ReplaceStaffServicesInput,
    ): StaffProfile {
        settle()
        val old = find(id)
        val pairs = input.services.map { it.serviceId to it.branchId }
        if (pairs.toSet().size != pairs.size) {
            throw MockErrors.validation("services", "Aynı hizmet ve şube bir kez verilebilir")
        }
        val services = catalog()
        input.services.forEach { skill ->
            val service = services.firstOrNull { it.id == skill.serviceId } ?: throw MockErrors.notFound("Hizmet")
            if (!service.isActive) throw MockErrors.conflict("Çakışma", "Pasif hizmete yetkinlik atanamaz")
        }
        val updated =
            old.copy(
                services =
                    input.services.mapIndexed { index, skill ->
                        StaffServiceSkill(
                            id = "${id.take(SKILL_ID_PREFIX)}-5c11-4000-8000-%012d".format(index + 1),
                            staffProfileId = id,
                            serviceId = skill.serviceId,
                            branchId = skill.branchId,
                            customDurationMinutes = skill.customDurationMinutes,
                            customPriceMinor = skill.customPriceMinor,
                            isActive = skill.isActive ?: true,
                        )
                    },
            )
        records[records.indexOf(old)] = updated
        return updated
    }

    private fun find(id: String): StaffProfile =
        records.firstOrNull { it.id == id } ?: throw MockErrors.notFound("Personel")

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    companion object {
        /**
         * Tohum. Renkler marka paletinden TÜREMEZ: takvimde personeli ayırt etmek için
         * birbirinden uzak tonlar gerekiyor ve `sage` ailesi bunu veremez. Rozet ve düğme
         * renkleri hâlâ token'lardan gelir; bu üç hex yalnız birer VERİ değeri (sunucu
         * `calendarColor` alanında aynısını gönderiyor), tasarım kararı değil.
         */
        val ALL: List<StaffProfile> =
            listOf(
                StaffProfile(
                    id = MockIds.STAFF_DERYA,
                    tenantId = MockIds.TENANT_NISANTASI,
                    userId = MockIds.USER_DERYA,
                    userFullName = "Derya Aksoy",
                    userEmail = "derya.aksoy@klinik.com",
                    primaryBranchId = MockIds.BRANCH_NISANTASI,
                    title = "Cilt bakım uzmanı",
                    specialties = listOf("Cilt bakımı", "Dolgu"),
                    calendarColor = "#1A6A7A",
                    bio = "Medikal estetikte on yıllık deneyim.",
                    services =
                        skills(
                            MockIds.STAFF_DERYA,
                            MockIds.SERVICE_SKIN_CARE,
                            MockIds.SERVICE_MASK,
                            MockIds.SERVICE_FILLER,
                        ),
                ),
                StaffProfile(
                    id = MockIds.STAFF_MERVE,
                    tenantId = MockIds.TENANT_NISANTASI,
                    userId = MockIds.USER_MERVE,
                    userFullName = "Merve Tunç",
                    userEmail = "merve.tunc@klinik.com",
                    primaryBranchId = MockIds.BRANCH_NISANTASI,
                    title = "Lazer uygulayıcı",
                    specialties = listOf("Lazer epilasyon"),
                    calendarColor = "#8A5A2B",
                    services =
                        skills(
                            MockIds.STAFF_MERVE,
                            MockIds.SERVICE_LASER,
                            MockIds.SERVICE_SKIN_CARE,
                            MockIds.SERVICE_MASK,
                        ),
                ),
                StaffProfile(
                    id = MockIds.STAFF_ONUR,
                    tenantId = MockIds.TENANT_NISANTASI,
                    userId = MockIds.USER_ONUR,
                    userFullName = "Onur Bayrak",
                    userEmail = "onur.bayrak@klinik.com",
                    primaryBranchId = MockIds.BRANCH_NISANTASI,
                    title = "Estetisyen",
                    calendarColor = "#6B4E9B",
                    isVisibleOnline = false,
                    // Pasif değil ama bir hizmette yetkin DEĞİL: A3.4'ün "yetkin
                    // personel" süzgeci elle sürülebilsin diye.
                    services = skills(MockIds.STAFF_ONUR, MockIds.SERVICE_CHECKUP, MockIds.SERVICE_FILLER),
                ),
            )

        private const val MIN_LATENCY_MILLIS = 120L
        private const val MAX_LATENCY_MILLIS = 400L
        private const val NEW_ID_BASE = 900

        /** Yetkinlik kimliği profilin ilk 8 hanesini taşır: iki profilin satırları çakışmasın. */
        private const val SKILL_ID_PREFIX = 8

        private fun skills(
            staffProfileId: String,
            vararg serviceIds: String,
        ): List<StaffServiceSkill> =
            serviceIds.mapIndexed { index, serviceId ->
                StaffServiceSkill(
                    id = "5c111000-0000-4000-8000-%012d".format(index + 1),
                    staffProfileId = staffProfileId,
                    serviceId = serviceId,
                    branchId = null,
                )
            }
    }
}

private fun Patch<String>.resolve(old: String?): String? =
    when (this) {
        Patch.Unchanged -> old
        Patch.Clear -> null
        is Patch.Set -> value
    }
