package com.klinara.android.services.crm

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.Page
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

class LiveCustomerService internal constructor(
    private val client: ApiClient,
) : CustomerService {
    override suspend fun list(query: CustomerListQuery): Page<Customer> =
        client.send(
            ApiRequest.get(
                "customers",
                query =
                    buildList {
                        query.limit?.let { add("limit" to it.toString()) }
                        query.cursor?.let { add("cursor" to it) }
                        query.tagId?.let { add("tagId" to it) }
                        // Unknown asla sorguya konmaz: sunucunun tanımadığı bir değer 400 verir.
                        query.source?.takeIf { it != CustomerSource.Unknown }?.let { add("source" to it.wire) }
                    },
            ),
        )

    override suspend fun get(id: String): Customer = client.send(ApiRequest.get("customers/$id"))

    // Zarf YOK: yanıt doğrudan bir dizi.
    override suspend fun search(
        query: String,
        limit: Int?,
    ): List<Customer> =
        client.send(
            ApiRequest.get(
                "customers/search",
                query =
                    buildList {
                        add("q" to query)
                        limit?.let { add("limit" to it.toString()) }
                    },
            ),
        )

    override suspend fun create(input: CreateCustomerInput): Customer =
        client.send(ApiRequest.post("customers", body = input.toJson().asBody()))

    override suspend fun update(
        id: String,
        input: UpdateCustomerInput,
    ): Customer = client.send(ApiRequest.patch("customers/$id", body = input.toJson().asBody()))

    override suspend fun archive(id: String): Customer = client.send(ApiRequest.delete("customers/$id"))

    override suspend fun replaceTags(
        customerId: String,
        tagIds: List<String>,
    ): Customer =
        client.send(
            ApiRequest.put(
                "customers/$customerId/tags",
                body =
                    buildJsonObject {
                        putJsonArray("tagIds") { tagIds.forEach { add(JsonPrimitive(it)) } }
                    }.asBody(),
            ),
        )

    // Etiket listesi ZARFLI — arama ucunun aksine. İki uç iki biçim taşıyor ve ikisi de
    // sözleşmede böyle yazıyor; birini diğerine benzetmek sessiz bir çözümleme hatası.
    override suspend fun tags(): List<CustomerTag> {
        val envelope: ListEnvelope<CustomerTag> = client.send(ApiRequest.get("customer-tags"))
        return envelope.data
    }

    override suspend fun createTag(
        name: String,
        color: String?,
    ): CustomerTag =
        client.send(
            ApiRequest.post(
                "customer-tags",
                body =
                    buildJsonObject {
                        put("name", name)
                        color?.let { put("color", it) }
                    }.asBody(),
            ),
        )

    override suspend fun updateTag(
        id: String,
        name: String?,
        color: Patch<String>,
    ): CustomerTag =
        client.send(
            ApiRequest.patch(
                "customer-tags/$id",
                body =
                    buildJsonObject {
                        name?.let { put("name", it) }
                        putPatch("color", color) { it }
                    }.asBody(),
            ),
        )

    override suspend fun deleteTag(id: String) = client.sendVoid(ApiRequest.delete("customer-tags/$id"))

    override suspend fun merge(
        targetCustomerId: String,
        sourceCustomerId: String,
    ): CustomerMergeResult =
        client.send(
            ApiRequest.post(
                "customers/$targetCustomerId/merge",
                body = buildJsonObject { put("sourceCustomerId", sourceCustomerId) }.asBody(),
            ),
        )
}

/** Gövde kurma tekrarını tek yere alır. */
private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
