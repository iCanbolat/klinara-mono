package com.klinara.android.services.packages

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject

class LivePackagesService internal constructor(
    private val client: ApiClient,
) : PackagesService {
    // --- Tanımlar ---

    override suspend fun definitions(query: PackageDefinitionQuery): Page<PackageDefinition> =
        client.send(
            ApiRequest.get(
                "package-definitions",
                query =
                    buildList {
                        query.cursor?.let { add("cursor" to it) }
                        query.limit?.let { add("limit" to it.toString()) }
                        query.branchId?.let { add("branchId" to it) }
                        query.serviceId?.let { add("serviceId" to it) }
                        // Sorgu dizesinde boolean yok, metin var: sunucu "true"/"false" bekliyor.
                        query.isActive?.let { add("isActive" to it.toString()) }
                    },
            ),
        )

    override suspend fun definition(id: String): PackageDefinition =
        client.send(ApiRequest.get("package-definitions/$id"))

    override suspend fun createDefinition(input: CreatePackageDefinitionInput): PackageDefinition =
        client.send(ApiRequest.post("package-definitions", body = input.toJson().asBody()))

    override suspend fun updateDefinition(
        id: String,
        version: Int,
        input: UpdatePackageDefinitionInput,
    ): PackageDefinition =
        client.send(
            ApiRequest.patch(
                "package-definitions/$id",
                body = input.toJson().asBody(),
                ifMatch = ApiRequest.weakETag(version),
            ),
        )

    override suspend fun retireDefinition(
        id: String,
        version: Int,
    ) = client.sendVoid(ApiRequest.delete("package-definitions/$id", ifMatch = ApiRequest.weakETag(version)))
}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
