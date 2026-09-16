package com.klinara.android.features.staff

import com.klinara.android.services.staff.MembershipInput
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/** A7.5 rol kuralları — web `staff-memberships.test.ts` ve iOS `MembershipRulesTests` ile aynı vakalar. */
class MembershipDraftTest {
    private val owner =
        MembershipViewer(userId = "o", roles = listOf("owner"), branchIds = emptyList(), tenantWide = true)
    private val managerB1 =
        MembershipViewer(userId = "m", roles = listOf("manager"), branchIds = listOf("b1"), tenantWide = false)

    private fun row(
        key: String,
        role: String,
        branch: String?,
    ) = MembershipRow(key, role, branch)

    @Test
    @DisplayName("Kimse kendinden yüksek rolü atayamaz; platform yöneticisi hiç listelenmez")
    fun assignable() {
        assertEquals(
            listOf("owner", "manager", "accountant", "receptionist", "practitioner"),
            MembershipRules.assignableRoles(owner.roles).map { it.key },
        )
        assertFalse("owner" in MembershipRules.assignableRoles(managerB1.roles).map { it.key })
    }

    @Test
    @DisplayName("Satır kilidi: rütbe ve erişilemeyen şube")
    fun rowLock() {
        assertEquals(MembershipLock.Rank, MembershipRules.lock(row("1", "owner", null), managerB1))
        assertEquals(MembershipLock.Branch, MembershipRules.lock(row("2", "practitioner", "b2"), managerB1))
        assertNull(MembershipRules.lock(row("3", "practitioner", "b1"), managerB1))
        assertNull(MembershipRules.lock(row("4", "practitioner", "b2"), owner))
    }

    @Test
    @DisplayName("Erişilemeyen tek şube satırı düzenleyiciyi kilitler; kendi rolü kilitli; rütbe kilidi kilitlemez")
    fun editorLock() {
        val rows = listOf(row("1", "practitioner", "b1"), row("2", "receptionist", "b2"))
        assertEquals(EditorLock.Branch, MembershipRules.editorLock("u", rows, managerB1))
        assertNull(MembershipRules.editorLock("u", rows, owner))
        assertEquals(EditorLock.Self, MembershipRules.editorLock("o", rows, owner))
        assertNull(MembershipRules.editorLock("u", listOf(row("3", "owner", null)), managerB1))
    }

    @Test
    @DisplayName("Doğrulama ve gövde: şube rolünde şube zorunlu, tekrar yasak, kiracı rolü şubesiz gider")
    fun validationAndInputs() {
        val rows =
            listOf(
                row("a", "practitioner", null),
                row("b", "receptionist", "b1"),
                row("c", "receptionist", "b1"),
                row("d", "accountant", null),
            )
        assertEquals(
            mapOf("a" to MembershipIssue.BranchRequired, "c" to MembershipIssue.Duplicate),
            MembershipRules.issues(rows),
        )
        assertEquals(
            listOf(MembershipInput("accountant")),
            MembershipRules.inputs(listOf(row("d", "accountant", "b1"))),
        )
        assertTrue(MembershipRules.same(rows, rows.reversed()))
    }
}
