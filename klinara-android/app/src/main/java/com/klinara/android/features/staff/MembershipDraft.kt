package com.klinara.android.features.staff

import com.klinara.android.services.auth.MembershipSummary
import com.klinara.android.services.contracts.RoleDefinition
import com.klinara.android.services.contracts.RoleDefinitions
import com.klinara.android.services.contracts.RoleScope
import com.klinara.android.services.staff.MembershipInput

/**
 * Rol/şube düzenleyicisinin SAF kuralları (A7.5) — web `lib/staff/memberships.ts` ve iOS
 * `MembershipRules` ile aynı. Rank ve kapsam ÜRETİLMİŞ [RoleDefinitions]'tan geliyor; iOS
 * bunları elle tutuyor (§7.8 notu).
 *
 * ⚠️ Yetki kapısı DEĞİL — sunucu (`role-rules.ts`) aynısını zorluyor:
 * 1. Kimse kendi rollerine dokunamaz.
 * 2. Kendi en yüksek rank'inden yüksek bir rolü ne atayabilir ne kaldırabilir.
 * 3. `PUT` tam değiştirme ve gönderilen HER şube erişim kontrolünden geçiyor: erişilemeyen
 *    şubedeki üyeliği "dokunmadan bırakmak" bile 403 → düzenleyici tamamen kilitli.
 * 4. Şube kapsamlı rol şube İSTER, kiracı kapsamlı rol şube ALMAZ.
 */
data class MembershipRow(
    /** İstemci anahtarı — sunucu kimliği değil. */
    val key: String,
    val roleKey: String,
    val branchId: String?,
)

data class MembershipViewer(
    val userId: String,
    val roles: List<String>,
    val branchIds: List<String>,
    val tenantWide: Boolean,
)

enum class MembershipLock { Rank, Branch }

enum class EditorLock { Self, Branch }

enum class MembershipIssue { BranchRequired, Duplicate }

object MembershipRules {
    fun highestRank(roles: List<String>): Int = roles.mapNotNull { RoleDefinitions.of(it)?.rank }.maxOrNull() ?: 0

    /** Atanabilir roller, yüksekten düşüğe; platform yöneticisi hariç. */
    fun assignableRoles(roles: List<String>): List<RoleDefinition> {
        val mine = highestRank(roles)
        return RoleDefinitions.all
            .filter { it.scope != RoleScope.Platform && it.rank <= mine }
            .sortedByDescending { it.rank }
    }

    fun isTenantScoped(roleKey: String): Boolean = RoleDefinitions.of(roleKey)?.scope == RoleScope.Tenant

    fun lock(
        row: MembershipRow,
        viewer: MembershipViewer,
    ): MembershipLock? {
        val role = RoleDefinitions.of(row.roleKey)
        if (role == null || role.rank > highestRank(viewer.roles)) return MembershipLock.Rank
        val outside = row.branchId != null && !viewer.tenantWide && row.branchId !in viewer.branchIds
        if (outside) return MembershipLock.Branch
        return null
    }

    fun editorLock(
        userId: String,
        rows: List<MembershipRow>,
        viewer: MembershipViewer,
    ): EditorLock? =
        when {
            viewer.userId == userId -> EditorLock.Self
            rows.any { lock(it, viewer) == MembershipLock.Branch } -> EditorLock.Branch
            else -> null
        }

    fun issues(rows: List<MembershipRow>): Map<String, MembershipIssue> {
        val result = mutableMapOf<String, MembershipIssue>()
        val seen = mutableSetOf<String>()
        rows.forEach { row ->
            if (!isTenantScoped(row.roleKey) && row.branchId == null) {
                result[row.key] = MembershipIssue.BranchRequired
                return@forEach
            }
            if (!seen.add("${row.roleKey}|${row.branchId.orEmpty()}")) result[row.key] = MembershipIssue.Duplicate
        }
        return result
    }

    fun rows(memberships: List<MembershipSummary>): List<MembershipRow> =
        memberships.map { MembershipRow(key = it.id, roleKey = it.roleKey, branchId = it.branchId) }

    fun inputs(rows: List<MembershipRow>): List<MembershipInput> =
        rows.map { MembershipInput(it.roleKey, if (isTenantScoped(it.roleKey)) null else it.branchId) }

    /** Sıradan bağımsız eşitlik — "kaydedilmemiş değişiklik var mı". */
    fun same(
        left: List<MembershipRow>,
        right: List<MembershipRow>,
    ): Boolean {
        fun keys(rows: List<MembershipRow>) = rows.map { "${it.roleKey}|${it.branchId.orEmpty()}" }.sorted()
        return keys(left) == keys(right)
    }
}
