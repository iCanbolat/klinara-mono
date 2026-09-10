package com.klinara.android.services.staff

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.ListEnvelope

class LiveStaffService internal constructor(
    private val client: ApiClient,
) : StaffService {
    override suspend fun list(): List<StaffProfile> =
        client.send<ListEnvelope<StaffProfile>>(ApiRequest.get("staff")).data
}
