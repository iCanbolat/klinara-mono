package com.klinara.android.features.shell

import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.auth.MeResponse
import com.klinara.android.services.auth.UserProfile
import com.klinara.android.services.contracts.RolePermissions

/**
 * Test oturumları.
 *
 * İzinler **elle yazılmaz**, üretilmiş `RolePermissions`'tan gelir: elle tutulan bir
 * liste iOS'ta bir kez saptı ve testler yeşil kalırken ekranlar erişilemez oldu.
 * Buradan üretilen oturum, mock modda kullanıcının gerçekten göreceği şeydir.
 */
internal object ShellSessions {
    val nisantasi = BranchSummary(id = "b-nisantasi", name = "Nişantaşı", timezone = "Europe/Istanbul")
    val bodrum = BranchSummary(id = "b-bodrum", name = "Bodrum", timezone = "Europe/Istanbul")

    fun forRole(
        role: String,
        branches: List<BranchSummary> = listOf(nisantasi),
    ) = AppSession(
        profile =
            MeResponse(
                user = UserProfile(id = "u-1", email = "test@klinara.app", fullName = "Test Kullanıcı"),
                tenantId = "t-1",
                roles = listOf(role),
                permissions = RolePermissions.forRole(role),
                branchIds = branches.map { it.id },
            ),
        branches = branches,
        activeBranchId = branches.firstOrNull()?.id,
    )
}
