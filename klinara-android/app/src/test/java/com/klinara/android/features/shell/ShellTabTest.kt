package com.klinara.android.features.shell

import com.klinara.android.services.contracts.RolePermissions
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * A2.1'in "Bitti" ölçütü.
 *
 * Sekme görünürlüğü **saf bir fonksiyondur** (izin kümesi → sekme kümesi). Bu yüzden
 * altı rolün altısı da burada doğrulanıyor ve mock'a bir "rol ekseni" eklenmedi:
 * geliştirici menüsünü, tek bir `assert`in kapattığı bir şey için büyütmek olurdu.
 */
class ShellTabTest {
    @Test
    @DisplayName("İzinsiz rol: Takvim sekmesi durur ama içerik kilitli; Yönetim ve Müşteriler gizli")
    fun roleWithoutPermissionsSeesLockedCalendar() {
        val session = ShellSessions.forRole("tanimsiz-rol")

        assertTrue(ShellTab.Calendar.isVisible(session), "Takvim sekmesi her rolde çizilir.")
        assertTrue(ShellTab.Dashboard.isVisible(session), "Dashboard açılış sekmesi, her rolde çizilir.")
        assertFalse(
            ShellTab.canSeeCalendar(session),
            "Randevu izni yok; içerik 'erişiminiz yok' demeli.",
        )
        assertFalse(ShellTab.Management.isVisible(session))
        assertFalse(ShellTab.Customers.isVisible(session))
    }

    @Test
    @DisplayName("owner ve manager beş sekmeyi de görür")
    fun privilegedRolesSeeEveryTab() {
        listOf("owner", "manager").forEach { role ->
            val session = ShellSessions.forRole(role)
            assertEquals(
                ShellTab.entries.toList(),
                ShellTab.visibleFor(session),
                "$role beş sekmeyi de görmeli",
            )
            assertTrue(ShellTab.canSeeCalendar(session))
        }
    }

    @Test
    @DisplayName("receptionist beş sekmeyi görür ve takvimi açar")
    fun receptionistSeesEveryTab() {
        val session = ShellSessions.forRole("receptionist")
        assertEquals(ShellTab.entries.toList(), ShellTab.visibleFor(session))
        assertTrue(ShellTab.canSeeCalendar(session))
    }

    @Test
    @DisplayName("practitioner: kendi randevuları yeter, Yönetim yine açık")
    fun practitionerSeesOwnCalendar() {
        val session = ShellSessions.forRole("practitioner")
        assertTrue(
            ShellTab.canSeeCalendar(session),
            "`appointment:read.own` tek başına takvimi açmalı — `read.all` şart değil.",
        )
        assertTrue(ShellTab.Management.isVisible(session), "service/staff/schedule:read taşıyor.")
    }

    @Test
    @DisplayName("izinsiz rol: yalnız Dashboard, Takvim ve Profil — hepsi boş durum")
    fun roleWithoutPermissionsStillHasAHome() {
        // platform_admin kiracı izinleri taşımıyor (üretilmiş demeti boş) — istemci
        // açısından "hiç izni olmayan kullanıcı" sınır durumunun ta kendisi.
        assertTrue(RolePermissions.forRole("platform_admin").isEmpty())
        val session = ShellSessions.forRole("platform_admin")

        assertEquals(listOf(ShellTab.Dashboard, ShellTab.Calendar, ShellTab.Profile), ShellTab.visibleFor(session))
        assertFalse(ShellTab.canSeeCalendar(session))
    }

    @Test
    @DisplayName("Yönetim koşulu yedi iznin HERHANGİ birine bakar")
    fun managementOpensForAnySingleAdminPermission() {
        ShellTab.MANAGEMENT_PERMISSIONS.forEach { permission ->
            val session = ShellSessions.forRole("owner").let { base ->
                base.copy(profile = base.profile.copy(permissions = listOf(permission)))
            }
            assertTrue(
                ShellTab.Management.isVisible(session),
                "Tek başına $permission Yönetim sekmesini açmalı",
            )
        }
    }

    @Test
    @DisplayName("Sıra: Dashboard açılış sekmesi, ardından Takvim")
    fun dashboardIsTheIndexTab() {
        assertEquals(listOf("Dashboard", "Takvim"), ShellTab.entries.take(2).map { it.label })
    }

    @Test
    @DisplayName("Şube menüsü yalnız birden fazla şubede anlamlı")
    fun branchMenuNeedsAChoice() {
        assertFalse(ShellSessions.forRole("manager").canSwitchBranch)
        assertTrue(
            ShellSessions
                .forRole("manager", listOf(ShellSessions.nisantasi, ShellSessions.bodrum))
                .canSwitchBranch,
        )
    }
}
