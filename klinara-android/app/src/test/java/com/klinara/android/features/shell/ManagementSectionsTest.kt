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
    @DisplayName("Katalog kartı `service:read` ile: yönetici, resepsiyon ve uygulayıcı görür, muhasebe görmez")
    fun catalogCard() {
        listOf("owner", "manager", "receptionist", "practitioner").forEach { role ->
            assertEquals(true, "Katalog" in titles(role), role)
        }
        assertEquals(false, "Katalog" in titles("accountant"))
    }

    @Test
    @DisplayName("Kart sırası iOS ile aynı: Katalog, Ekip, Takvim kurulumu, sonra Müşteriler ve Paketler")
    fun order() {
        assertEquals(
            listOf("Katalog", "Ekip", "Takvim kurulumu", "Müşteriler", "Paketler", "İletişim"),
            titles("manager"),
        )
    }

    @Test
    @DisplayName("İletişim kartı `notification:read` ile: muhasebe görmez, uygulayıcı görür (A8.1)")
    fun communicationCard() {
        listOf("owner", "manager", "receptionist", "practitioner").forEach { role ->
            val card = managementSections(ShellSessions.forRole(role)).firstOrNull { it.title == "İletişim" }
            assertEquals(
                listOf(ManagementDestination.Inbox, ManagementDestination.MessageLog),
                card?.rows?.map { it.destination }?.take(2),
                role,
            )
        }
        assertEquals(false, "İletişim" in titles("accountant"))
    }

    @Test
    @DisplayName("Her satır route'a sahip bir hedef — boş kart yok")
    fun noEmptySections() {
        listOf("owner", "manager", "receptionist", "practitioner", "accountant").forEach { role ->
            managementSections(ShellSessions.forRole(role)).forEach { assertEquals(true, it.rows.isNotEmpty()) }
        }
    }
}
