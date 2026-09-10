package com.klinara.android.services.files

import com.klinara.android.services.networking.ApiClient
import com.klinara.android.services.networking.ApiRequest
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.RequestBodyPayload
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class LiveFilesService internal constructor(
    private val client: ApiClient,
) : FilesService {
    override suspend fun presign(
        customerId: String,
        contentType: String,
        sizeBytes: Long,
        kind: FileKind,
    ): PresignUpload =
        client.send(
            ApiRequest.post(
                "uploads/presign",
                body =
                    buildJsonObject {
                        put("customerId", customerId)
                        put("contentType", contentType)
                        put("sizeBytes", sizeBytes)
                        put("kind", kind.wire)
                    }.asBody(),
            ),
        )

    override suspend fun confirm(
        customerId: String,
        storageKey: String,
        kind: FileKind,
        position: FilePosition,
        groupId: String?,
        sha256: String?,
    ): CustomerFile =
        client.send(
            ApiRequest.post(
                "customers/$customerId/files",
                body =
                    buildJsonObject {
                        put("storageKey", storageKey)
                        put("kind", kind.wire)
                        put("position", position.wire)
                        groupId?.let { put("groupId", it) }
                        sha256?.let { put("sha256", it) }
                    }.asBody(),
            ),
        )

    override suspend fun files(customerId: String): List<CustomerFile> {
        val envelope: ListEnvelope<CustomerFile> = client.send(ApiRequest.get("customers/$customerId/files"))
        return envelope.data
    }

    override suspend fun groups(customerId: String): List<FileGroup> {
        val envelope: ListEnvelope<FileGroup> = client.send(ApiRequest.get("customers/$customerId/file-groups"))
        return envelope.data
    }

    override suspend fun createGroup(
        customerId: String,
        title: String,
        bodyArea: String?,
        serviceId: String?,
    ): FileGroup =
        client.send(
            ApiRequest.post(
                "customers/$customerId/file-groups",
                body =
                    buildJsonObject {
                        put("title", title)
                        bodyArea?.let { put("bodyArea", it) }
                        serviceId?.let { put("serviceId", it) }
                    }.asBody(),
            ),
        )

    override suspend fun downloadUrl(
        fileId: String,
        variant: FileVariant,
    ): DownloadUrl =
        client.send(
            ApiRequest.get("files/$fileId/download-url", query = listOf("variant" to variant.wire)),
        )

    override suspend fun delete(fileId: String) = client.sendVoid(ApiRequest.delete("files/$fileId"))
}

private fun JsonObject.asBody(): RequestBodyPayload =
    RequestBodyPayload(KlinaraJson.encodeToString(JsonObject.serializer(), this))
