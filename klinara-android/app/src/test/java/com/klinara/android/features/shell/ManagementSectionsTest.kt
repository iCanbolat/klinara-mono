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
    @DisplayName("Kart sırası iOS ile aynı: Katalog önce, sonra Müşteriler ve Paketler")
    fun order() {
        assertEquals(listOf("Katalog", "Müşteriler", "Paketler"), titles("manager"))
    }

    @Test
    @DisplayName("Her satır route'a sahip bir hedef — boş kart yok")
    fun noEmptySections() {
        listOf("owner", "manager", "receptionist", "practitioner", "accountant").forEach { role ->
            managementSections(ShellSessions.forRole(role)).forEach { assertEquals(true, it.rows.isNotEmpty()) }
        }
    }
}
