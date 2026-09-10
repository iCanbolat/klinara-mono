package com.klinara.android.services.files

import com.klinara.android.services.mock.MockErrors
import com.klinara.android.services.mock.MockIds
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.random.Random

/**
 * Dosya mock'u — **bellek içi bir nesne deposu** ile birlikte.
 *
 * Üç sunucu kuralını taklit ediyor; taklit etmeseydi bu yollar yalnız canlıda görülürdü:
 *
 * 1. **`confirm` yüklenmemiş bir anahtarı reddeder** — `presign` alıp PUT'u atlayan
 *    bir istemci kayıt açamaz.
 * 2. **Anahtar öneki doğrulanır** — başka bir kiracının/müşterinin yoluna yazma denemesi
 *    `403`.
 * 3. **Küçük görsel GECİKMELİ gelir** — `confirm` anında `hasThumbnail = false`, birkaç
 *    saniye sonra true. Yer tutucu yolu ancak böyle sürülebilir.
 */
class MockFilesService(
    private val latencyEnabled: Boolean = true,
    private val random: Random = Random.Default,
    /** Kuyruk gecikmesi; testte 0 verilir. */
    private val thumbnailDelayMillis: Long = THUMBNAIL_DELAY_MILLIS,
) : FilesService {
    var failing: Boolean = false

    /** `storageKey` → yüklenmiş nesne. PUT bunu doldurur. */
    private val objects: MutableMap<String, ByteArray> = mutableMapOf()
    private val files: MutableList<CustomerFile> = mutableListOf()
    private val groups: MutableList<FileGroup> = mutableListOf()
    private var idCounter: Int = 0

    /** `SignedUploader` yerine mock akışta çağrılır: imzalı PUT'un karşılığı. */
    fun putObject(
        storageKey: String,
        data: ByteArray,
    ) {
        objects[storageKey] = data
    }

    override suspend fun presign(
        customerId: String,
        contentType: String,
        sizeBytes: Long,
        kind: FileKind,
    ): PresignUpload {
        settle()

        if (!FileContentType.isAllowed(contentType)) {
            throw MockErrors.validation("contentType", "Bu dosya türü desteklenmiyor")
        }
        if (sizeBytes > FileContentType.MAX_BYTES) {
            throw MockErrors.validation("sizeBytes", "Dosya 25 MB sınırını aşıyor")
        }

        idCounter += 1
        // Anahtar SUNUCUDA üretilir: istemciye bırakılsaydı başka bir kiracının yoluna
        // yazmayı deneyebilirdi.
        val key = "${MockIds.TENANT_NISANTASI}/$customerId/${"%08d".format(idCounter)}"
        // presign DB'ye HİÇBİR ŞEY yazmıyor — yarıda kalan yükleme asılı satır bırakmasın.
        return PresignUpload(
            storageKey = key,
            uploadUrl = "https://mock-storage.klinara.test/$key",
            contentType = contentType,
            expiresAt = SEED_NOW.plusSeconds(PRESIGN_TTL_SECONDS),
        )
    }

    override suspend fun confirm(
        customerId: String,
        storageKey: String,
        kind: FileKind,
        position: FilePosition,
        groupId: String?,
        sha256: String?,
    ): CustomerFile {
        settle()

        // Önek doğrulaması — başka müşterinin yoluna yazma denemesi.
        if (!storageKey.contains("/$customerId/")) {
            throw MockErrors.forbidden("Bu anahtar bu müşteriye ait değil.")
        }
        // Yükleme atlandıysa kayıt AÇILMAZ: `presign` bir söz değil, bir izindir.
        val data = objects[storageKey] ?: throw MockErrors.validation("storageKey", "Nesne bulunamadı")

        idCounter += 1
        val file =
            CustomerFile(
                id = "f11e0000-0000-4000-8000-%012d".format(idCounter),
                customerId = customerId,
                groupId = groupId,
                kind = kind,
                position = position,
                // Boyut ve tip NESNENİN KENDİSİNDEN okunuyor, istemci beyanından değil.
                mimeType = FileContentType.detect(data) ?: FileContentType.JPEG,
                sizeBytes = data.size.toLong(),
                sha256 = sha256,
                // Küçük görsel HENÜZ YOK: kuyruk işi birkaç saniye sürüyor.
                hasThumbnail = false,
                createdAt = SEED_NOW.plusSeconds(idCounter.toLong()),
            )
        files += file
        groupId?.let { attachToGroup(it, file) }
        scheduleThumbnail(file.id)
        return file
    }

    override suspend fun files(customerId: String): List<CustomerFile> {
        settle()
        return files.filter { it.customerId == customerId }.sortedByDescending { it.createdAt }
    }

    override suspend fun groups(customerId: String): List<FileGroup> {
        settle()
        return groups.map { group -> group.copy(files = files.filter { it.groupId == group.id }) }
    }

    override suspend fun createGroup(
        customerId: String,
        title: String,
        bodyArea: String?,
        serviceId: String?,
    ): FileGroup {
        settle()
        if (title.isBlank()) throw MockErrors.validation("title", "Başlık boş olamaz")

        idCounter += 1
        val group =
            FileGroup(
                id = "6a0d0000-0000-4000-8000-%012d".format(idCounter),
                title = title.trim(),
                bodyArea = bodyArea,
                serviceId = serviceId,
                createdAt = SEED_NOW.plusSeconds(idCounter.toLong()),
            )
        groups += group
        return group
    }

    override suspend fun downloadUrl(
        fileId: String,
        variant: FileVariant,
    ): DownloadUrl {
        settle()

        val file = files.firstOrNull { it.id == fileId } ?: throw MockErrors.notFound("Dosya")
        // Hazır olmayan küçük görsel `409` verir ve TAM BOYUTA DÜŞMEZ. Sessiz düşüş,
        // ızgaranın farkında olmadan 25 MB'lık nesneler indirmesi olurdu.
        if (variant == FileVariant.Thumb && !file.hasThumbnail) {
            throw MockErrors.conflict("Küçük görsel hazır değil", "Kuyruk işi henüz tamamlanmadı.")
        }
        return DownloadUrl(
            url = "https://mock-storage.klinara.test/download/$fileId/${variant.wire}",
            expiresAt = SEED_NOW.plusSeconds(DOWNLOAD_TTL_SECONDS),
        )
    }

    override suspend fun delete(fileId: String) {
        settle()
        if (files.none { it.id == fileId }) throw MockErrors.notFound("Dosya")
        // Kayıt düşer, NESNE depoda kalır: saklama yükümlülüğü.
        files.removeAll { it.id == fileId }
    }

    /** Test için: kuyruk işini elle tamamlar. */
    fun completeThumbnail(fileId: String) {
        val index = files.indexOfFirst { it.id == fileId }
        if (index >= 0) files[index] = files[index].copy(hasThumbnail = true)
    }

    private fun scheduleThumbnail(fileId: String) {
        if (thumbnailDelayMillis <= 0) completeThumbnail(fileId)
    }

    private fun attachToGroup(
        groupId: String,
        file: CustomerFile,
    ) {
        val index = groups.indexOfFirst { it.id == groupId }
        if (index >= 0) groups[index] = groups[index].copy(files = groups[index].files + file)
    }

    private suspend fun settle() {
        if (latencyEnabled) delay(random.nextLong(MIN_LATENCY_MILLIS, MAX_LATENCY_MILLIS))
        if (failing) throw ApiError.Network()
    }

    private companion object {
        const val MIN_LATENCY_MILLIS = 120L
        const val MAX_LATENCY_MILLIS = 400L
        const val THUMBNAIL_DELAY_MILLIS = 3_000L
        const val PRESIGN_TTL_SECONDS = 300L
        const val DOWNLOAD_TTL_SECONDS = 300L
        val SEED_NOW: Instant = Instant.parse("2026-09-08T09:00:00Z")
    }
}
