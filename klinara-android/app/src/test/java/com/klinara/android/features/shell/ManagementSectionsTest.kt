package com.klinara.android.features.shell

import org.junit.jupiter.api.Assertions.assertEquals
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
    @DisplayName("Katalog kartı `service:read` ile: yönetici, resepsiyon ve uygulayıcı görür")
    fun catalogCard() {
        listOf("owner", "manager", "receptionist", "practitioner").forEach { role ->
            assertEquals(true, "Katalog" in titles(role), role)
        }
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
    @DisplayName("İletişim kartı `notification:read` ile: uygulayıcı da görür (A8.1)")
    fun communicationCard() {
        listOf("owner", "manager", "receptionist", "practitioner").forEach { role ->
            val card = managementSections(ShellSessions.forRole(role)).firstOrNull { it.title == "İletişim" }
            assertEquals(
                listOf(
                    ManagementDestination.Inbox,
                    ManagementDestination.MessageLog,
                    ManagementDestination.ReminderSettings,
                    ManagementDestination.NotificationTemplates,
                    ManagementDestination.NotificationPreferences,
                ),
                card?.rows?.map { it.destination }?.take(5),
                role,
            )
        }
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
        assertEquals(listOf(ManagementDestination.Staff, ManagementDestination.Branches), rows("receptionist"))
        assertEquals(listOf(ManagementDestination.Staff, ManagementDestination.Branches), rows("practitioner"))
    }
}
