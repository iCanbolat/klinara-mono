package com.klinara.android.services.branches

import com.klinara.android.services.auth.BranchSummary
import com.klinara.android.services.crm.Patch
import com.klinara.android.services.crm.putPatchElement
import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant

// `apps/api/src/modules/tenancy/dto/tenant.dto.ts` karşılıkları (A7.4).

/**
 * `BranchResponseDto` — şube yönetim ekranının TAM şekli.
 *
 * [BranchSummary] bunun dar hâli ve oturum boyunca şube menüsünü besliyor. Şube
 * **silinmez**: `isActive = false` pasife alır. [slug] oluşturulduktan sonra değişmez.
 */
@Serializable
data class BranchDetail(
    val id: String,
    val tenantId: String = "",
    val slug: String,
    val name: String,
    val timezone: String = "Europe/Istanbul",
    val phone: String? = null,
    val address: String? = null,
    val isActive: Boolean = true,
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
) {
    fun toSummary(): BranchSummary =
        BranchSummary(id = id, name = name, timezone = timezone, address = address, isActive = isActive)
}

/** `CreateBranchDto` — yalnız `branch:write` (owner). */
data class CreateBranchInput(
    val slug: String,
    val name: String,
    val timezone: String? = null,
    val phone: String? = null,
    val address: String? = null,
) {
    fun toJson(): JsonObject =
        buildJsonObject {
            put("slug", slug)
            put("name", name)
            timezone?.let { put("timezone", it) }
            phone?.let { put("phone", it) }
            address?.let { put("address", it) }
        }
}

/** `UpdateBranchDto` — telefon ve adres üç durumlu ([Patch]): boşaltılan alan `null`. */
data class UpdateBranchInput(
    val name: String? = null,
    val timezone: String? = null,
    val phone: Patch<String> = Patch.Unchanged,
    val address: Patch<String> = Patch.Unchanged,
    val isActive: Boolean? = null,
) {
    val isEmpty: Boolean
        get() =
            name == null && timezone == null && isActive == null &&
                phone == Patch.Unchanged && address == Patch.Unchanged

    fun toJson(): JsonObject =
        buildJsonObject {
            name?.let { put("name", it) }
            timezone?.let { put("timezone", it) }
            putPatchElement("phone", phone) { JsonPrimitive(it) }
            putPatchElement("address", address) { JsonPrimitive(it) }
            isActive?.let { put("isActive", it) }
        }
}

/** Şube kodu önerisi ve biçim kontrolü — web `slugify` / iOS `BranchSlug` ile aynı kural. */
object BranchSlug {
    private val PATTERN = Regex("^[a-z0-9]+(-[a-z0-9]+)*$")
    private val TURKISH = mapOf('ç' to 'c', 'ğ' to 'g', 'ı' to 'i', 'ö' to 'o', 'ş' to 's', 'ü' to 'u')
    private const val MAX = 50
    private const val MIN = 3

    fun suggest(name: String): String {
        val folded =
            java.text.Normalizer
                .normalize(
                    name.lowercase(java.util.Locale.forLanguageTag("tr")).map { TURKISH[it] ?: it }.joinToString(""),
                    java.text.Normalizer.Form.NFKD,
                ).replace(Regex("\\p{M}+"), "")
        return folded
            .replace(Regex("[^a-z0-9]+"), "-")
            .trim('-')
            .take(MAX)
            .trimEnd('-')
    }

    fun isValid(slug: String): Boolean = slug.length in MIN..MAX && PATTERN.matches(slug)
}
