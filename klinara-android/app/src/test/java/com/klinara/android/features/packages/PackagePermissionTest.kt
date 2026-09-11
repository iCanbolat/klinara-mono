package com.klinara.android.features.packages

import com.klinara.android.features.shell.ShellSessions
import com.klinara.android.services.contracts.Permissions
import com.klinara.android.services.packages.CustomerPackageStatus
import com.klinara.android.services.packages.MockPackagesSeed
import com.klinara.android.services.packages.MockPackagesService
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * A5'in izin kapıları — altı rolün altısı, üretilmiş `RolePermissions`'tan.
 *
 * `package:refund` ve `package:transfer` `package:write` üzerine BİNMEZ; bu test o
 * ayrımın ekranda da korunduğunu çiviliyor. Mock yalnız manager ve practitioner'ı
 * sürebildiği için (A2.1 kararı) matris emülatörde değil burada.
 */
class PackagePermissionTest {
    private val now = Instant.parse("2026-09-11T09:00:00Z")

    private suspend fun ayse() =
        MockPackagesService(latencyEnabled = false).customerPackage(MockPackagesSeed.SOLD_AYSE_PACKAGE)

    private fun operationsFor(
        role: String,
        pkg: com.klinara.android.services.packages.CustomerPackage,
    ) = availableOperations(pkg, ShellSessions.forRole(role).packagePermissions, now)

    @Test
    @DisplayName("Rol başına işlem matrisi: resepsiyon iade/devir YAPAMAZ, muhasebe düzeltme/satış YAPAMAZ")
    fun roleMatrix() =
        runTest {
            val pkg = ayse()
            val all = listOf(PackageOperation.Adjust, PackageOperation.Refund, PackageOperation.Transfer)

            assertEquals(all, operationsFor("owner", pkg))
            assertEquals(all, operationsFor("manager", pkg))
            assertEquals(listOf(PackageOperation.Adjust), operationsFor("receptionist", pkg))
            assertEquals(listOf(PackageOperation.Refund), operationsFor("accountant", pkg))
            assertEquals(emptyList<PackageOperation>(), operationsFor("practitioner", pkg))
        }

    @Test
    @DisplayName("Kapalı, süresi dolmuş ya da devredilemez pakette işlem düğmesi ÇİZİLMİYOR")
    fun stateGates() =
        runTest {
            val pkg = ayse()

            val refunded = pkg.copy(status = CustomerPackageStatus.Refunded)
            assertEquals(emptyList<PackageOperation>(), operationsFor("owner", refunded))
            // Süresi geçmiş ama durumu henüz `active` (cron çalışmadı): iade/devir yok, düzeltme var.
            val lapsed = pkg.copy(expiresAt = now.minusSeconds(1))
            assertEquals(listOf(PackageOperation.Adjust), operationsFor("owner", lapsed))
            assertEquals(
                listOf(PackageOperation.Adjust, PackageOperation.Refund),
                operationsFor("owner", pkg.copy(isTransferable = false)),
            )
        }

    @Test
    @DisplayName("Paket bölümü `package:read` ile, satış `package:write` ile — muhasebe satış yapamaz")
    fun sectionAndSaleGates() {
        assertEquals(true, ShellSessions.forRole("accountant").can(Permissions.PACKAGE_READ))
        assertEquals(false, ShellSessions.forRole("accountant").packagePermissions.canWrite)
        assertEquals(true, ShellSessions.forRole("practitioner").can(Permissions.PACKAGE_READ))
    }
}
