package com.klinara.android.services.staff

import com.klinara.android.services.auth.UserProfile
import com.klinara.android.services.booking.AvailabilityQuery
import com.klinara.android.services.booking.MockBookingService
import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.time.Instant

class StaffServicesTest {
    private val service = MockStaffService(latencyEnabled = false)

    @Test
    @DisplayName("Profil fixture'ı çözülüyor; iki şube kapsamlı lazer TEK hizmet sayılıyor, pasif yetkinlik sayılmıyor")
    fun profileDecodes() {
        val profile = KlinaraJson.decodeFromString(StaffProfile.serializer(), Fixtures.read("staff/staff-profile.json"))

        assertEquals("mehmet@demo-klinik.test", profile.userEmail)
        assertNull(profile.bio)
        assertEquals(3, profile.services.size)
        assertEquals(1, profile.activeServiceCount)
    }

    @Test
    @DisplayName("Kullanıcı listesi çözülüyor: davet bekleyen hesap `hasPassword: false`")
    fun usersDecode() {
        val users =
            KlinaraJson.decodeFromString(
                ListEnvelope.serializer(UserProfile.serializer()),
                Fixtures.read("staff/users-list.json"),
            )
        assertFalse(users.data.single().hasPassword)
        assertEquals("receptionist", users.data.single().memberships.single().roleKey)
    }

    @Test
    @DisplayName("Güncelleme gövdesi unvanı ve birincil şubeyi açık null ile TEMİZLİYOR")
    fun updateClears() {
        val body = UpdateStaffProfileInput(title = Patch.Clear, primaryBranchId = Patch.Clear).toJson()
        assertEquals(JsonNull, body["title"])
        assertEquals(JsonNull, body["primaryBranchId"])
        assertFalse("bio" in body)
        assertTrue(UpdateStaffProfileInput().isEmpty)
    }

    @Test
    @DisplayName("Aynı kullanıcıya ikinci profil 409, bilinmeyen kullanıcı 404")
    fun createRules() =
        runTest {
            val duplicate =
                assertThrows<ApiError.Problem> { service.create(CreateStaffProfileInput(MockIds.USER_DERYA)) }
            assertEquals(ApiErrorCode.CONFLICT, duplicate.problem.code)

            val unknown = assertThrows<ApiError.Problem> { service.create(CreateStaffProfileInput("yok")) }
            assertEquals(ApiErrorCode.NOT_FOUND, unknown.problem.code)

            val created = service.create(CreateStaffProfileInput(MockIds.USER_RECEPTION, title = "Resepsiyon"))
            assertEquals("Elif Kaya", created.userFullName)
            assertTrue(created.services.isEmpty(), "Yetkinlik oluşturmada değil matriste")
        }

    @Test
    @DisplayName("Yetkinlik değişimi: aynı (hizmet, şube) çifti 400, pasif hizmet 409")
    fun replaceRules() =
        runTest {
            val duplicate =
                assertThrows<ApiError.Problem> {
                    service.replaceSkills(
                        MockIds.STAFF_ONUR,
                        ReplaceStaffServicesInput(
                            List(2) { StaffServiceSkillInput(MockIds.SERVICE_LASER) },
                        ),
                    )
                }
            assertEquals(ApiErrorCode.VALIDATION_FAILED, duplicate.problem.code)

            val inactive =
                assertThrows<ApiError.Problem> {
                    service.replaceSkills(
                        MockIds.STAFF_ONUR,
                        ReplaceStaffServicesInput(listOf(StaffServiceSkillInput(MockIds.SERVICE_MASK))),
                    )
                }
            assertEquals(ApiErrorCode.CONFLICT, inactive.problem.code)

            // Farklı şube kapsamları aynı hizmette geçerli.
            val scoped =
                service.replaceSkills(
                    MockIds.STAFF_ONUR,
                    ReplaceStaffServicesInput(
                        listOf(
                            StaffServiceSkillInput(MockIds.SERVICE_LASER),
                            StaffServiceSkillInput(MockIds.SERVICE_LASER, branchId = MockIds.BRANCH_BODRUM),
                        ),
                    ),
                )
            assertEquals(2, scoped.services.size)
        }

    @Test
    @DisplayName("Patch.Clear unvanı siliyor; pasife almak PATCH isActive=false")
    fun updateAndDeactivate() =
        runTest {
            val updated =
                service.update(MockIds.STAFF_DERYA, UpdateStaffProfileInput(title = Patch.Clear, isActive = false))
            assertNull(updated.title)
            assertFalse(updated.isActive)
            assertEquals("#1A6A7A", updated.calendarColor, "Unchanged dokunmaz")
        }

    @Test
    @DisplayName("Randevu motoru personel TABLOSUNU okuyor: yetkinlik kalkınca slot adayı düşüyor")
    fun bookingSeesSkillChanges() =
        runTest {
            val clock = BranchClock("Europe/Istanbul")
            val booking =
                MockBookingService(
                    latencyEnabled = false,
                    catalog = MockCatalogService(latencyEnabled = false)::snapshotServices,
                    staff = service::snapshotProfiles,
                )
            // Tohumun uğramadığı uzak bir gün: yalnız yetkinlik belirlesin.
            val day = clock.startOfDay(clock.adding(30L, Instant.now()))
            val query =
                AvailabilityQuery(
                    branchId = MockIds.BRANCH_NISANTASI,
                    serviceIds = listOf(MockIds.SERVICE_LASER),
                    from = day,
                    to = clock.adding(1L, day),
                )
            val before = booking.availability(query).slots.flatMap { it.staffProfileIds }.toSet()
            assertEquals(setOf(MockIds.STAFF_MERVE), before)

            service.replaceSkills(MockIds.STAFF_MERVE, ReplaceStaffServicesInput(emptyList()))
            assertTrue(booking.availability(query).slots.isEmpty())
        }
}
