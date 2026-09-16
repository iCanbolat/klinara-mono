package com.klinara.android.features.calendar

import com.klinara.android.features.shell.ShellSessions
import com.klinara.android.services.booking.AppointmentStatus
import com.klinara.android.services.contracts.Permissions
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * İzin kapıları saf bir fonksiyondur: rol → görünen aksiyon kümesi.
 *
 * `MockScenario` yalnız `manager` ve `practitioner` sürüyor; altı rolü elle gezmek
 * geliştirici menüsüne üçüncü bir eksen eklemek olurdu. A2.1'de `ShellTabTest` için
 * verilen kararın aynısı: testi ucuz, elle gezmesi pahalı.
 */
class AppointmentPermissionTest {
    @Test
    @DisplayName("`practitioner` randevu yazabilir ama YENİDEN AÇAMAZ")
    fun practitionerCannotReopen() {
        val session = ShellSessions.forRole("practitioner")

        assertTrue(session.can(Permissions.APPOINTMENT_WRITE), "Uygulayıcı randevu durumunu değiştirebilmeli.")
        assertTrue(
            !session.can(Permissions.APPOINTMENT_REOPEN),
            "Yeniden açma defterde ters kayıt üretiyor; ayrı bir izin ve yönetici seviyesinde.",
        )
        assertTrue(
            AppointmentStatus.Completed.allowedTransitions(session.can(Permissions.APPOINTMENT_REOPEN)).isEmpty(),
            "İzin yoksa tamamlanmış randevuda hiç düğme çizilmemeli (§7.4).",
        )
    }

    @Test
    @DisplayName("Tanımsız rol randevu yazamaz — aksiyon kartı HİÇ çizilmez")
    fun unknownRoleSeesNoActions() {
        val session = ShellSessions.forRole("tanimsiz-rol")

        assertTrue(!session.can(Permissions.APPOINTMENT_WRITE))
        assertTrue(!session.can(Permissions.APPOINTMENT_REOPEN))
    }

    @Test
    @DisplayName("Yönetici seviyesinde yeniden açma var")
    fun managerCanReopen() {
        val session = ShellSessions.forRole("manager")

        assertTrue(session.can(Permissions.APPOINTMENT_WRITE))
        assertTrue(session.can(Permissions.APPOINTMENT_REOPEN))
        assertTrue(
            AppointmentStatus.Completed.allowedTransitions(canReopen = true).isNotEmpty(),
        )
    }
}
