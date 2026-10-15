package com.klinara.android.features.shell

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * Yönetim hub'ının kart matrisi — altı rolün altısı, üretilmiş `RolePermissions`'tan.
 *
 * Mock yalnız manager ve practitioner'ı sürebildiği için (A2.1 kararı) matris emülatörde
 * değil burada. Kapı KART düzeyinde: okuma izni kartı açar, yazma ekranın içinde sorulur.
 */
class ManagementSectionsTest {
    private fun titles(role: String) = managementSections(ShellSessions.forRole(role)).map { it.title }

    @Test
    @DisplayName("Katalog kartı operasyon ekibinde (`service:read` + `appointment:read.all`); uygulayıcıda yok")
    fun catalogCard() {
        listOf("owner", "manager", "receptionist").forEach { role ->
            assertEquals(true, "Katalog" in titles(role), role)
        }
        assertFalse("Katalog" in titles("practitioner"))
    }

    @Test
    @DisplayName("Uygulayıcı yalnız kendi programını ve performansını görür")
    fun practitionerHub() {
        assertEquals(listOf("Çalışma saatleri", "Raporlar"), titles("practitioner"))
        val rows = managementSections(ShellSessions.forRole("practitioner")).flatMap { it.rows }.map { it.destination }
        assertEquals(
            listOf(ManagementDestination.MySchedule, ManagementDestination.BranchHours, ManagementDestination.Reports),
            rows,
        )
    }

    @Test
    @DisplayName("Her hedefin bir ikonu var ve ikonlar birbirinden farklı")
    fun everyDestinationHasADistinctIcon() {
        val icons = ManagementDestination.entries.associateWith { it.icon }
        // 0, "kaynak bulunamadı" demek: eşleme bir hedefi atlarsa satır ikonsuz çizilir.
        assertEquals(emptyList<ManagementDestination>(), icons.filterValues { it == 0 }.keys.toList())
        // Aynı ikonu iki satıra vermek, ikon koymanın tek gerekçesini (ayırt edicilik) siler.
        assertEquals(ManagementDestination.entries.size, icons.values.toSet().size)
    }

    @Test
    @DisplayName("Kart sırası iOS ile aynı: Katalog en üstte, Raporlar en sonda")
    fun order() {
        assertEquals(
            listOf(
                "Katalog",
                "Şube ve Personel",
                "Takvim kurulumu",
                "Müşteriler",
                "Paketler",
                "İletişim",
                "Raporlar",
            ),
            titles("manager"),
        )
    }

    @Test
    @DisplayName("İletişim kartı: şablon ve hatırlatma yönetenlerde; resepsiyon yalnız sohbet ve günlük; uygulayıcı yok")
    fun communicationCard() {
        fun rows(role: String) =
            managementSections(ShellSessions.forRole(role))
                .firstOrNull { it.title == "İletişim" }
                ?.rows
                ?.map { it.destination }
        listOf("owner", "manager").forEach { role ->
            assertEquals(
                listOf(
                    ManagementDestination.Conversations,
                    ManagementDestination.MessageLog,
                    ManagementDestination.ReminderSettings,
                    ManagementDestination.NotificationTemplates,
                    ManagementDestination.WhatsApp,
                ),
                rows(role),
                role,
            )
        }
        assertEquals(listOf(ManagementDestination.Conversations, ManagementDestination.MessageLog), rows("receptionist"))
        assertEquals(null, rows("practitioner"))
    }

    @Test
    @DisplayName("Sohbetler `notification:send` ile: resepsiyon görür, uygulayıcı görmez")
    fun conversationsRow() {
        fun has(role: String) =
            managementSections(ShellSessions.forRole(role))
                .flatMap { it.rows }
                .any { it.destination == ManagementDestination.Conversations }
        listOf("owner", "manager", "receptionist").forEach { assertTrue(has(it), it) }
        assertFalse(has("practitioner"))
    }

    @Test
    @DisplayName("Her satır route'a sahip bir hedef — boş kart yok")
    fun noEmptySections() {
        listOf("owner", "manager", "receptionist", "practitioner").forEach { role ->
            managementSections(ShellSessions.forRole(role)).forEach { assertEquals(true, it.rows.isNotEmpty()) }
        }
    }

    @Test
    @DisplayName("Şube ve Personel (A7.4–A7.5): şubeler `branch:read`, davetler `user:invite` ile")
    fun teamRows() {
        fun rows(role: String) =
            managementSections(ShellSessions.forRole(role))
                .firstOrNull { it.title == "Şube ve Personel" }
                ?.rows
                ?.map { it.destination }

        assertEquals(
            listOf(ManagementDestination.Staff, ManagementDestination.Branches, ManagementDestination.Invitations),
            rows("owner"),
        )
        assertEquals(
            listOf(ManagementDestination.Staff, ManagementDestination.Branches, ManagementDestination.Invitations),
            rows("manager"),
        )
        // Ekip yönetimi `user:read` ya da `staff:write` ister: resepsiyon ve uygulayıcıda kart yok.
        assertEquals(null, rows("receptionist"))
        assertEquals(null, rows("practitioner"))
    }
}
