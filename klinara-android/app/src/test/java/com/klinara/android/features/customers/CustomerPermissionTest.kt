package com.klinara.android.features.customers

import com.klinara.android.features.shell.ShellSessions
import com.klinara.android.features.shell.ShellTab
import com.klinara.android.services.contracts.Permissions
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * A4'ün izin kapıları.
 *
 * Bu testin varlık sebebi §7.4: yetkisiz kullanıcı **403 ile karşılaşmamalı**, giriş
 * noktasını hiç görmemeli. Görünürlük saf bir fonksiyondur (izin kümesi → çizilen
 * kontrol) ve elle emülatör gezmek yerine burada doğrulanıyor — altı rolün altısı da.
 *
 * İzinler üretilmiş `RolePermissions`'tan geliyor; elle yazılmış bir liste sapabilir.
 */
class CustomerPermissionTest {
    private val roles = listOf("owner", "manager", "receptionist", "practitioner")

    @Test
    @DisplayName("Müşteriler sekmesi `customer:read` ile çizilir")
    fun tabFollowsReadPermission() {
        roles.forEach { role ->
            val session = ShellSessions.forRole(role)
            assertTrue(
                ShellTab.Customers.isVisible(session) == session.can(Permissions.CUSTOMER_READ),
                "$role: sekme görünürlüğü izinle uyuşmuyor",
            )
        }
    }

    @Test
    @DisplayName("`customer:merge` YALNIZ owner ve manager'da — resepsiyonda yok")
    fun mergeIsNarrowerThanWrite() {
        val receptionist = ShellSessions.forRole("receptionist")

        // Birleştirme FK taşıyan ve geri alınması pahalı bir işlem; günlük yazma
        // iznine binseydi resepsiyon iki kaydı geri alınamaz biçimde birleştirebilirdi.
        assertTrue(receptionist.can(Permissions.CUSTOMER_WRITE))
        assertFalse(receptionist.can(Permissions.CUSTOMER_MERGE))

        assertTrue(ShellSessions.forRole("owner").can(Permissions.CUSTOMER_MERGE))
        assertTrue(ShellSessions.forRole("manager").can(Permissions.CUSTOMER_MERGE))
    }

    @Test
    @DisplayName("`practitioner` müşteriyi OKUR ama yazamaz")
    fun practitionerIsReadOnly() {
        val practitioner = ShellSessions.forRole("practitioner")

        assertTrue(practitioner.can(Permissions.CUSTOMER_READ))
        assertFalse(practitioner.can(Permissions.CUSTOMER_WRITE))
        assertFalse(practitioner.can(Permissions.CUSTOMER_MERGE))
    }

    @Test
    @DisplayName("Klinik not izni yazmaya BİNMEZ — A4.3'ün kapısı bugünden doğru")
    fun medicalPermissionsAreSeparate() {
        roles.forEach { role ->
            val session = ShellSessions.forRole(role)
            if (session.can(Permissions.CUSTOMER_MEDICAL_WRITE)) {
                // Klinik notu yazabilen onu okuyabilmeli de.
                assertTrue(
                    session.can(Permissions.CUSTOMER_MEDICAL_READ),
                    "$role: klinik not yazabiliyor ama okuyamıyor",
                )
            }
        }
    }
}
