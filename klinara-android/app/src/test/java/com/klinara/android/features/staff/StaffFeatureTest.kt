package com.klinara.android.features.staff

import com.klinara.android.features.shell.ShellSessions
import com.klinara.android.features.shell.managementSections
import com.klinara.android.services.catalog.MockCatalogService
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.staff.MockStaffService
import com.klinara.android.services.staff.MockUsersService
import com.klinara.android.services.staff.StaffProfile
import com.klinara.android.services.staff.StaffServiceSkillInput
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class StaffFeatureTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterEach fun tearDown() = Dispatchers.resetMain()

    // --- Matris taslağı ---

    private val laserId = "e1000000-0000-4000-8000-000000000001"
    private val otherId = "e1000000-0000-4000-8000-000000000002"
    private val bodrum = "b1000000-0000-4000-8000-000000000002"

    private fun fixtureProfile(): StaffProfile =
        KlinaraJson.decodeFromString(StaffProfile.serializer(), Fixtures.read("staff/staff-profile.json"))

    private fun catalog(vararg ids: String) =
        ids.map { id -> MockCatalogService.ALL.first().copy(id = id, isActive = true) }

    @Test
    @DisplayName("Matris KAYIPSIZ: ikinci şube kapsamı ve pasif yetkinlik dokunulmadan geri yazılıyor")
    fun matrixIsLossless() {
        val draft = SkillMatrixDraft.of(fixtureProfile().services, catalog(laserId, otherId))

        assertFalse(draft.isDirty)
        assertEquals(1, draft.row(laserId).extraScopes)
        assertNull(draft.row(laserId).branchId, "Düzenlenen satır kiracı geneli olan")
        val wire = draft.wire()
        assertEquals(3, wire.size, "iOS burada 1 yazardı: Bodrum kapsamı ve pasif satır silinirdi")
        assertTrue(
            wire.any { it.branchId == bodrum && it.customDurationMinutes == 75 && it.customPriceMinor == 300_000L },
        )
        assertTrue(wire.any { it.serviceId == otherId && it.isActive == false })
    }

    @Test
    @DisplayName("Pasif hizmetin yetkinliği geri yazılamaz: `dropped`'a düşüyor ve ekran bunu söylüyor")
    fun inactiveServiceSkillsDropped() {
        val draft = SkillMatrixDraft.of(fixtureProfile().services, catalog(laserId))

        assertEquals(1, draft.dropped.size)
        assertTrue(draft.wire().none { it.serviceId == otherId })
    }

    @Test
    @DisplayName("Kapsamı korunan satırınkiyle aynı yapınca korunan düşüyor — aynı çift sunucuda 400")
    fun scopeCollisionDedupes() {
        val draft = SkillMatrixDraft.of(fixtureProfile().services, catalog(laserId, otherId)).withScope(laserId, bodrum)
        val laserRows = draft.wire().filter { it.serviceId == laserId }

        assertEquals(1, laserRows.size)
        assertEquals(bodrum, laserRows.single().branchId)
        assertTrue(draft.isDirty)
    }

    @Test
    @DisplayName("Anahtar açıp kapatmak taslağı kirletip temizliyor; özel süre gövdeye giriyor")
    fun toggleAndDuration() {
        val base = SkillMatrixDraft.of(emptyList(), catalog(laserId))
        val on = base.toggle(laserId, true).withCustomDuration(laserId, 50)

        assertTrue(on.isDirty)
        assertEquals(listOf(StaffServiceSkillInput(laserId, null, 50, null, true)), on.wire())
        assertFalse(on.toggle(laserId, false).isDirty)
    }

    // --- Profil taslağı ---

    @Test
    @DisplayName("Profil taslağı yalnız değişeni gönderiyor; unvanı boşaltmak TEMİZLEME")
    fun profileDraft() {
        val draft = StaffProfileDraft.of(MockStaffService.ALL.first())
        assertFalse(draft.isDirty)

        val input = draft.copy(title = "  ", primaryBranchId = null).updateInput()
        assertEquals(Patch.Clear, input.title)
        assertEquals(Patch.Clear, input.primaryBranchId)
        assertEquals(Patch.Unchanged, input.bio)
        assertNull(input.specialties)
    }

    // --- Liste, oluşturma, detay ---

    @Test
    @DisplayName("Aday kullanıcılar profili olanları dışlıyor: oturumdaki yönetici ve resepsiyon kalıyor")
    fun candidatesExcludeProfiled() =
        runTest {
            val viewModel =
                StaffCreateViewModel(MockStaffService(latencyEnabled = false), MockUsersService(latencyEnabled = false))
            viewModel.load()
            advanceUntilIdle()

            val names = viewModel.state.value.candidates.valueOrNull?.map { it.fullName }
            assertEquals(listOf("Ayşe Yılmaz", "Elif Kaya"), names)
        }

    @Test
    @DisplayName("Oluşturma `created`'a düşüyor; kullanıcı seçilmeden kaydedilemiyor")
    fun createFlow() =
        runTest {
            val staff = MockStaffService(latencyEnabled = false)
            val viewModel = StaffCreateViewModel(staff, MockUsersService(latencyEnabled = false))
            viewModel.save()
            advanceUntilIdle()
            assertNull(viewModel.state.value.created)

            viewModel.update { it.copy(userId = MockIds.USER_RECEPTION, specialties = listOf("Karşılama")) }
            viewModel.save()
            advanceUntilIdle()

            val created = viewModel.state.value.created
            assertNotNull(created)
            assertEquals(listOf("Karşılama"), created?.specialties)
            assertTrue(staff.snapshotProfiles().any { it.userId == MockIds.USER_RECEPTION })
        }

    @Test
    @DisplayName("Liste araması uzmanlıkta da arıyor, pasifler istenmedikçe gizli")
    fun listFilter() {
        val profiles = MockStaffService.ALL.mapIndexed { i, p -> if (i == 2) p.copy(isActive = false) else p }
        assertEquals(listOf(MockIds.STAFF_MERVE), filteredStaff(profiles, "LAZER", showsInactive = false).map { it.id })
        assertEquals(2, filteredStaff(profiles, "", showsInactive = false).size)
        assertEquals(3, filteredStaff(profiles, "", showsInactive = true).size)
    }

    @Test
    @DisplayName("Detay kaydı taslağı sunucunun yanıtından yeniden kuruyor; matristen dönüş kirli taslağı ezmiyor")
    fun detailSaveAndReload() =
        runTest {
            val viewModel = StaffDetailViewModel(MockStaffService(latencyEnabled = false), MockIds.STAFF_DERYA)
            viewModel.load()
            advanceUntilIdle()

            viewModel.update { it.copy(bio = "Yeni") }
            viewModel.load() // matristen dönüş
            advanceUntilIdle()
            assertEquals("Yeni", viewModel.state.value.draft.bio)

            viewModel.save()
            advanceUntilIdle()
            assertTrue(viewModel.state.value.didSave)
            assertFalse(viewModel.state.value.draft.isDirty)
            assertEquals("Yeni", viewModel.state.value.profile.valueOrNull?.bio)
        }

    @Test
    @DisplayName("Matris kaydı listeyi TAM yazıyor ve sayıyı güncelliyor")
    fun matrixSave() =
        runTest {
            val staff = MockStaffService(latencyEnabled = false)
            val viewModel =
                StaffServiceMatrixViewModel(staff, MockCatalogService(latencyEnabled = false), MockIds.STAFF_ONUR)
            viewModel.load()
            advanceUntilIdle()

            viewModel.update { it.toggle(MockIds.SERVICE_LASER, true) }
            viewModel.save()
            advanceUntilIdle()

            assertTrue(viewModel.state.value.didSave)
            val onur = staff.snapshotProfiles().first { it.id == MockIds.STAFF_ONUR }
            assertTrue(onur.isCompetent(MockIds.SERVICE_LASER, MockIds.BRANCH_NISANTASI))
            assertEquals(3, onur.activeServiceCount)
        }

    // --- İzin matrisi ---

    @Test
    @DisplayName("Ekip kartı `staff:read` ile; oluşturma `staff:write` + `user:read` — yalnız owner ve manager")
    fun permissions() {
        val roles = listOf("owner", "manager", "receptionist", "practitioner", "accountant")
        val sees = roles.filter { role -> managementSections(ShellSessions.forRole(role)).any { it.title == "Ekip" } }
        assertEquals(listOf("owner", "manager", "receptionist", "practitioner"), sees)

        val creates = roles.filter { canCreateStaff(ShellSessions.forRole(it)) }
        assertEquals(listOf("owner", "manager"), creates)
    }
}
