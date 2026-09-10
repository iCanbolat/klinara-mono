package com.klinara.android.services.catalog

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.ListEnvelope

class LiveCatalogService internal constructor(
    private val client: ApiClient,
) : CatalogService {
    override suspend fun services(): List<ClinicService> =
        client.send<ListEnvelope<ClinicService>>(ApiRequest.get("services")).data
}
