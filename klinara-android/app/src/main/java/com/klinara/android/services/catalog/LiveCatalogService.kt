package com.klinara.android.services.catalog

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject

class LiveCatalogService internal constructor(
    private val client: ApiClient,
) : CatalogService {
    override suspend fun categories(): List<ServiceCategory> =
        client.send<ListEnvelope<ServiceCategory>>(ApiRequest.get("service-categories")).data

    override suspend fun createCategory(input: CreateServiceCategoryInput): ServiceCategory =
        client.send(ApiRequest.post("service-categories", body = input.toJson().asBody()))

    override suspend fun updateCategory(
        id: String,
        input: UpdateServiceCategoryInput,
    ): ServiceCategory = client.send(ApiRequest.patch("service-categories/$id", body = input.toJson().asBody()))

    // `send`, `sendVoid` DEĞİL: sunucu pasife alınmış kaydı 200 ile geri veriyor.
    override suspend fun deactivateCategory(id: String): ServiceCategory =
        client.send(ApiRequest.delete("service-categories/$id"))

    override suspend fun services(): List<ClinicService> =
        client.send<ListEnvelope<ClinicService>>(ApiRequest.get("services")).data

    override suspend fun service(id: String): ClinicService = client.send(ApiRequest.get("services/$id"))

    override suspend fun createService(input: CreateServiceInput): ClinicService =
        client.send(ApiRequest.post("services", body = input.toJson().asBody()))

    override suspend fun updateService(
        id: String,
        input: UpdateServiceInput,
    ): ClinicService = client.send(ApiRequest.patch("services/$id", body = input.toJson().asBody()))

    override suspend fun deactivateService(id: String): ClinicService = client.send(ApiRequest.delete("services/$id"))
}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
