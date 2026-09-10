package com.klinara.android.services.crm

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest

class LiveCustomerService internal constructor(
    private val client: ApiClient,
) : CustomerService {
    override suspend fun get(id: String): Customer = client.send(ApiRequest.get("customers/$id"))

    // Zarf YOK: yanıt doğrudan bir dizi.
    override suspend fun search(query: String): List<Customer> =
        client.send(ApiRequest.get("customers/search", query = listOf("q" to query)))
}
