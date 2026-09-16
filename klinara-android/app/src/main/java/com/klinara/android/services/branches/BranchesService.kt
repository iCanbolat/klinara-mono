package com.klinara.android.services.branches

import com.klinara.android.services.crm.Patch
import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiError
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import java.time.Instant

/**
 * Şube yönetimi uçları (A7.4) — iOS `BranchesService` paritesi.
 *
 * `GET branches` girişte `AuthService.branches()` ile de çağrılıyor ama orada dar
 * `BranchSummary` yeterli; yönetim ekranı tam şekle bakıyor. Silme ucu YOK.
 */
interface BranchesService {
    /** `GET branches` — pasifler dahil kiracının tüm şubeleri. */
    suspend fun list(): List<BranchDetail>

    /** `POST branches` — aynı kodla ikinci şube 409. */
    suspend fun create(input: CreateBranchInput): BranchDetail

    /** `PATCH branches/:id`. */
    suspend fun update(
        id: String,
        input: UpdateBranchInput,
    ): BranchDetail
}

class LiveBranchesService internal constructor(
    private val client: ApiClient,
) : BranchesService {
    override suspend fun list(): List<BranchDetail> =
        client.send<ListEnvelope<BranchDetail>>(ApiRequest.get("branches")).data

    override suspend fun create(input: CreateBranchInput): BranchDetail =
        client.send(ApiRequest.post("branches", body = input.toJson().asBody()))

    override suspend fun update(
        id: String,
        input: UpdateBranchInput,
    ): BranchDetail = client.send(ApiRequest.patch("branches/$id", body = input.toJson().asBody()))
}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))

/**
 * Bellek-içi şube tablosu. [MockIds] şubeleriyle tohumlu: personel ve takvim mock'larının
 * şube kimlikleri burada da tanınsın. Sunucunun "aynı kod 409" kuralını taklit eder.
 */
class MockBranchesService(
    private val latencyEnabled: Boolean = true,
    /** Ağ hatası senaryosunda şubeler de düşsün diye; container kurarken verilir. */
    var failing: Boolean = false,
) : BranchesService {
    private val records: MutableList<BranchDetail> = ALL.toMutableList()
    private var idCounter = 0

    override suspend fun list(): List<BranchDetail> {
        settle()
        return records.toList()
    }

    override suspend fun create(input: CreateBranchInput): BranchDetail {
        settle()
        if (records.any { it.slug == input.slug }) {
            throw MockErrors.conflict(
                "Bu şube kodu zaten kullanımda",
                "\"${input.slug}\" bu klinikte başka bir şubeye ait.",
            )
        }
        idCounter += 1
        val created =
            BranchDetail(
                id = "b-mock-$idCounter",
                tenantId = MockIds.TENANT_NISANTASI,
                slug = input.slug,
                name = input.name,
                timezone = input.timezone ?: "Europe/Istanbul",
                phone = input.phone,
                address = input.address,
                createdAt = Instant.now(),
            )
        records += created
        return created
    }

    override suspend fun update(
        id: String,
        input: UpdateBranchInput,
    ): BranchDetail {
        settle()
        val index = records.indexOfFirst { it.id == id }
        if (index < 0) throw MockErrors.notFound("Şube")
        val old = records[index]
        val updated =
            old.copy(
                name = input.name ?: old.name,
                timezone = input.timezone ?: old.timezone,
                phone = input.phone.resolve(old.phone),
                address = input.address.resolve(old.address),
                isActive = input.isActive ?: old.isActive,
            )
        records[index] = updated
        return updated
    }

    private suspend fun settle() {
        if (latencyEnabled) delay(LATENCY_MILLIS)
        if (failing) throw ApiError.Network()
    }

    companion object {
        private const val LATENCY_MILLIS = 250L

        val ALL: List<BranchDetail> =
            listOf(
                BranchDetail(
                    id = MockIds.BRANCH_NISANTASI,
                    tenantId = MockIds.TENANT_NISANTASI,
                    slug = "nisantasi",
                    name = "Nişantaşı",
                    phone = "+902122345678",
                    address = "Teşvikiye Cad. No: 12, Şişli",
                ),
                BranchDetail(
                    id = MockIds.BRANCH_BODRUM,
                    tenantId = MockIds.TENANT_NISANTASI,
                    slug = "bodrum",
                    name = "Bodrum",
                    address = "Neyzen Tevfik Cad. No: 44, Bodrum",
                ),
            )
    }
}

private fun Patch<String>.resolve(old: String?): String? =
    when (this) {
        Patch.Unchanged -> old
        Patch.Clear -> null
        is Patch.Set -> value
    }
