package com.klinara.android.services.staff

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject

class LiveStaffService internal constructor(
    private val client: ApiClient,
) : StaffService {
    override suspend fun list(branchId: String?): List<StaffProfile> =
        client
            .send<ListEnvelope<StaffProfile>>(
                ApiRequest.get("staff", query = listOfNotNull(branchId?.let { "branchId" to it })),
            ).data

    override suspend fun profile(id: String): StaffProfile = client.send(ApiRequest.get("staff/$id"))

    override suspend fun create(input: CreateStaffProfileInput): StaffProfile =
        client.send(ApiRequest.post("staff", body = input.toJson().asBody()))

    override suspend fun update(
        id: String,
        input: UpdateStaffProfileInput,
    ): StaffProfile = client.send(ApiRequest.patch("staff/$id", body = input.toJson().asBody()))

    override suspend fun replaceSkills(
        id: String,
        input: ReplaceStaffServicesInput,
    ): StaffProfile = client.send(ApiRequest.put("staff/$id/services", body = input.toJson().asBody()))
}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
