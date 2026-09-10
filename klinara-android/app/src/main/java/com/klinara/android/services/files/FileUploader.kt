package com.klinara.android.services.files

import com.klinara.android.services.networking.SignedUploader
import java.security.MessageDigest

/** Yükleme adımı — ilerleme arayüzü hangi aşamada olduğunu SÖYLEYEBİLSİN diye. */
enum class UploadStep {
    Preparing,
    RequestingUrl,
    Uploading,
    Confirming,
    ;

    val turkishName: String
        get() =
            when (this) {
                Preparing -> "Hazırlanıyor…"
                RequestingUrl -> "Yükleme adresi alınıyor…"
                Uploading -> "Yükleniyor…"
                Confirming -> "Kaydediliyor…"
            }
}

/**
 * Üç adımlı yükleme zinciri: `presign` → imzalı PUT → `confirm`.
 *
 * Adımlar **ayrı ayrı** raporlanıyor çünkü hataları da ayrı: "adres alınamadı" ile
 * "yükleme yarıda kesildi" kullanıcıya farklı şeyler söyler ve farklı çözümleri var.
 *
 * `sha256` istemci beyanıdır ve sunucu onu **worker'da doğrular**: `HeadObject` içerik
 * özeti vermiyor (ETag çok parçalı yüklemede hash değildir) ve nesneyi `confirm`
 * içinde indirmek maliyetli olurdu.
 */
class FileUploader(
    private val files: FilesService,
    private val uploader: SignedUploader?,
    /** Mock modda imzalı PUT yerine bellek içi depoya yazılır. */
    private val mockFiles: MockFilesService? = null,
) {
    suspend fun upload(
        customerId: String,
        data: ByteArray,
        contentType: String,
        kind: FileKind,
        position: FilePosition = FilePosition.Other,
        groupId: String? = null,
        onStep: (UploadStep) -> Unit = {},
    ): CustomerFile {
        onStep(UploadStep.Preparing)
        val digest = sha256(data)

        onStep(UploadStep.RequestingUrl)
        val ticket = files.presign(customerId, contentType, data.size.toLong(), kind)

        onStep(UploadStep.Uploading)
        // Content-Type presign yanıtıyla BAYT BAYT aynı gitmeli: imza onu kapsıyor ve
        // başka bir değer imzayı geçersiz kılar.
        if (mockFiles != null) {
            mockFiles.putObject(ticket.storageKey, data)
        } else {
            uploader?.upload(ticket.uploadUrl, data, ticket.contentType)
        }

        onStep(UploadStep.Confirming)
        return files.confirm(
            customerId = customerId,
            storageKey = ticket.storageKey,
            kind = kind,
            position = position,
            groupId = groupId,
            sha256 = digest,
        )
    }

    private fun sha256(data: ByteArray): String =
        MessageDigest
            .getInstance("SHA-256")
            .digest(data)
            .joinToString("") { "%02x".format(it) }
}
