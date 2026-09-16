package com.klinara.android.services.branches

import com.klinara.android.services.auth.MembershipSummary
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.staff.Invitation
import com.klinara.android.services.staff.MembershipInput
import com.klinara.android.services.staff.MockStaffService
import com.klinara.android.services.staff.MockUsersService
import com.klinara.android.services.staff.StaffProfile
import com.klinara.android.services.staff.membershipsBody
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.time.Instant

/** A7.4–A7.5 sözleşmesi — `klinara-fixtures/{branches,staff}` gerçek gövdeleriyle. */
class BranchServicesTest {
    @Test
    @DisplayName("Tam şube listesi çözülüyor; pasif şube dar özete pasif taşınıyor")
    fun branchesDecode() {
        val list =
            KlinaraJson.decodeFromString(
                ListEnvelope.serializer(BranchDetail.serializer()),
                Fixtures.read("branches/branches-detail.json"),
            )
        assertEquals(3, list.data.size)
        assertFalse(list.data.last().toSummary().isActive)
        assertNull(list.data[1].phone)
    }

    @Test
    @DisplayName("Personel profili branchIds taşıyor: ana şube VEYA üyelik şubesi eşleşir")
    fun staffBranchIds() {
        val profile = KlinaraJson.decodeFromString(StaffProfile.serializer(), Fixtures.read("staff/staff-profile.json"))
        assertTrue(profile.worksIn(MockIds.BRANCH_NISANTASI))
        assertTrue(profile.worksIn(MockIds.BRANCH_BODRUM))
        assertFalse(profile.worksIn("b-baska"))
    }

    @Test
    @DisplayName("Üyelik ve davet listeleri çözülüyor; kiracı kapsamlı satırın şubesi yok")
    fun membershipsAndInvitations() {
        val memberships =
            KlinaraJson.decodeFromString(
                ListEnvelope.serializer(MembershipSummary.serializer()),
                Fixtures.read("staff/user-memberships.json"),
            )
        assertNull(memberships.data.single { it.roleKey == "owner" }.branchId)

        val invitations =
            KlinaraJson.decodeFromString(
                ListEnvelope.serializer(Invitation.serializer()),
                Fixtures.read("staff/invitations-list.json"),
            )
        assertTrue(invitations.data.all { it.isPending })
        val now = Instant.parse("2026-09-21T00:00:00Z")
        assertTrue(invitations.data[1].isExpired(now))
        assertFalse(invitations.data[0].isExpired(now))
    }

    @Test
    @DisplayName("Gövdeler: boş telefon açık null; kiracı rolü şubesiz; değişmeyen alan hiç yazılmıyor")
    fun bodies() {
        val patch = UpdateBranchInput(phone = Patch.Clear, isActive = false).toJson()
        assertEquals(JsonNull, patch["phone"])
        assertFalse("address" in patch)
        assertTrue(UpdateBranchInput().isEmpty)

        val put = membershipsBody(listOf(MembershipInput("owner"), MembershipInput("manager", "b1")))
        val rows = put["memberships"] as JsonArray
        assertFalse("branchId" in (rows[0] as JsonObject))
        assertEquals("b1", (rows[1] as JsonObject)["branchId"]?.toString()?.trim('"'))
    }

    @Test
    @DisplayName("Mock sözleşmesi: aynı kod 409, kapsam dışı üyelik 400; şube süzgeci sunucu kuralıyla")
    fun mockRules() =
        runTest {
            val branches = MockBranchesService(latencyEnabled = false)
            assertThrows<ApiError> { branches.create(CreateBranchInput(slug = "nisantasi", name = "Kopya")) }

            val users = MockUsersService(latencyEnabled = false)
            val noBranch = listOf(MembershipInput("practitioner"))
            val tenantWithBranch = listOf(MembershipInput("owner", MockIds.BRANCH_BODRUM))
            assertThrows<ApiError> { users.replaceMemberships(MockIds.USER_DERYA, noBranch) }
            assertThrows<ApiError> { users.replaceMemberships(MockIds.USER_DERYA, tenantWithBranch) }

            val staff = MockStaffService(latencyEnabled = false)
            val all = staff.list()
            val nisantasi = staff.list(MockIds.BRANCH_NISANTASI)
            assertTrue(nisantasi.all { it.worksIn(MockIds.BRANCH_NISANTASI) })
            assertTrue(nisantasi.size <= all.size)
        }
}
