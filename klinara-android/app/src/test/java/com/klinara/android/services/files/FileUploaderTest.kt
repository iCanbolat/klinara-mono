package com.klinara.android.services.files

import com.klinara.android.services.mock.MockCustomers
import com.klinara.android.services.networking.ApiError
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * Üç adımlı yükleme zinciri.
 *
 * Sıra sunucunun kuralıdır ve mock onu **zorluyor**: `presign` alıp PUT'u atlayan bir
 * istemci kayıt açamaz.
 */
class FileUploaderTest {
    private val customer = MockCustomers.ALL.first().id
    private val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte()) + ByteArray(64)

    private fun files() = MockFilesService(latencyEnabled = false, thumbnailDelayMillis = 0)

    private fun uploader(service: MockFilesService) =
        FileUploader(files = service, uploader = null, mockFiles = service)

    @Test
    @DisplayName("Zincir SIRAYLA yürüyor: presign → PUT → confirm")
    fun theChainRunsInOrder() =
        runTest {
            val service = files()
            val steps = mutableListOf<UploadStep>()

            val file =
                uploader(service).upload(
                    customerId = customer,
                    data = jpeg,
                    contentType = FileContentType.JPEG,
                    kind = FileKind.Photo,
                    onStep = { steps += it },
                )

            assertEquals(
                listOf(
                    UploadStep.Preparing,
                    UploadStep.RequestingUrl,
                    UploadStep.Uploading,
                    UploadStep.Confirming,
                ),
                steps,
            )
            assertEquals(FileKind.Photo, file.kind)
            // sha256 istemci beyanı olarak gidiyor; worker doğruluyor.
            assertEquals(SHA256_HEX_LENGTH, file.sha256?.length)
        }

    @Test
    @DisplayName("YÜKLEME ATLANIRSA `confirm` reddedilir — asılı kayıt oluşmaz")
    fun confirmWithoutUploadIsRejected() =
        runTest {
            val service = files()
            val ticket = service.presign(customer, FileContentType.JPEG, jpeg.size.toLong(), FileKind.Photo)

            // PUT hiç yapılmadı: `presign` bir söz değil, bir izindir.
            val error =
                runCatching {
                    service.confirm(customer, ticket.storageKey, FileKind.Photo)
                }.exceptionOrNull()

            assertTrue(error is ApiError.Problem)
            assertTrue(service.files(customer).isEmpty())
        }

    @Test
    @DisplayName("`presign` DB'ye hiçbir şey yazmaz — yarıda kalan yükleme iz bırakmaz")
    fun presignWritesNothing() =
        runTest {
            val service = files()
            service.presign(customer, FileContentType.JPEG, jpeg.size.toLong(), FileKind.Photo)

            assertTrue(service.files(customer).isEmpty())
        }

    @Test
    @DisplayName("BAŞKA müşterinin anahtarına yazma denemesi 403")
    fun crossCustomerKeyIsForbidden() =
        runTest {
            val service = files()
            val other = MockCustomers.ALL[1].id
            val ticket = service.presign(other, FileContentType.JPEG, jpeg.size.toLong(), FileKind.Photo)
            service.putObject(ticket.storageKey, jpeg)

            val error =
                runCatching { service.confirm(customer, ticket.storageKey, FileKind.Photo) }.exceptionOrNull()

            assertTrue(error is ApiError.Problem)
        }

    @Test
    @DisplayName("Boyut ve MIME NESNEDEN okunuyor, istemci beyanından değil")
    fun metadataComesFromTheObject() =
        runTest {
            val service = files()
            // İstemci yalan söylüyor: 10 bayt diyor.
            val ticket = service.presign(customer, FileContentType.JPEG, 10, FileKind.Photo)
            service.putObject(ticket.storageKey, jpeg)

            val file = service.confirm(customer, ticket.storageKey, FileKind.Photo)

            assertEquals(jpeg.size.toLong(), file.sizeBytes)
            assertEquals(FileContentType.JPEG, file.mimeType)
        }

    @Test
    @DisplayName("Desteklenmeyen tür ve 25 MB üstü `presign`de reddedilir")
    fun presignValidatesTypeAndSize() =
        runTest {
            val service = files()

            assertTrue(
                runCatching {
                    service.presign(customer, "image/svg+xml", 100, FileKind.Document)
                }.exceptionOrNull() is ApiError.Problem,
            )
            assertTrue(
                runCatching {
                    service.presign(customer, FileContentType.JPEG, FileContentType.MAX_BYTES + 1, FileKind.Photo)
                }.exceptionOrNull() is ApiError.Problem,
            )
        }

    @Test
    @DisplayName("HAZIR OLMAYAN `thumb` 409 verir ve tam boyuta DÜŞMEZ")
    fun unreadyThumbDoesNotFallBack() =
        runTest {
            // Kuyruk gecikmesi açık: küçük görsel henüz yok.
            val service = MockFilesService(latencyEnabled = false, thumbnailDelayMillis = 3_000L)
            val ticket = service.presign(customer, FileContentType.JPEG, jpeg.size.toLong(), FileKind.Photo)
            service.putObject(ticket.storageKey, jpeg)
            val file = service.confirm(customer, ticket.storageKey, FileKind.Photo)

            assertFalse(file.hasThumbnail)
            val error =
                runCatching { service.downloadUrl(file.id, FileVariant.Thumb) }.exceptionOrNull()

            // Sessiz düşüş, ızgaranın farkında olmadan 25 MB'lık nesneler indirmesi
            // olurdu — bu yüzden 409 bir hata değil, "henüz değil" demek.
            assertTrue(error is ApiError.Problem)
            // Tam boyut yine de alınabiliyor: 409 yalnız küçük görsele ait.
            assertTrue(service.downloadUrl(file.id, FileVariant.Original).url.isNotEmpty())
        }

    @Test
    @DisplayName("Kuyruk işi bitince `thumb` alınabiliyor")
    fun thumbBecomesAvailable() =
        runTest {
            val service = MockFilesService(latencyEnabled = false, thumbnailDelayMillis = 3_000L)
            val ticket = service.presign(customer, FileContentType.JPEG, jpeg.size.toLong(), FileKind.Photo)
            service.putObject(ticket.storageKey, jpeg)
            val file = service.confirm(customer, ticket.storageKey, FileKind.Photo)

            service.completeThumbnail(file.id)

            assertTrue(service.downloadUrl(file.id, FileVariant.Thumb).url.contains("thumb"))
        }

    @Test
    @DisplayName("Silme kaydı düşürür; NESNE depoda kalır")
    fun deleteArchivesTheRecord() =
        runTest {
            val service = files()
            val file =
                uploader(service).upload(customer, jpeg, FileContentType.JPEG, FileKind.Photo)

            service.delete(file.id)

            assertTrue(service.files(customer).none { it.id == file.id })
            // İkinci silme 404: kayıt zaten düştü.
            assertTrue(runCatching { service.delete(file.id) }.exceptionOrNull() is ApiError.Problem)
        }

    @Test
    @DisplayName("Gruba yüklenen fotoğraf o grupta ve o konumda görünüyor")
    fun uploadingIntoAGroupSetsThePosition() =
        runTest {
            val service = files()
            val group = service.createGroup(customer, "Sağ kol")

            uploader(service).upload(
                customerId = customer,
                data = jpeg,
                contentType = FileContentType.JPEG,
                kind = FileKind.Photo,
                position = FilePosition.Before,
                groupId = group.id,
            )

            val reloaded = service.groups(customer).first { it.id == group.id }
            assertEquals(FilePosition.Before, reloaded.file(FilePosition.Before)?.position)
            assertEquals(null, reloaded.file(FilePosition.After))
        }
}

private const val SHA256_HEX_LENGTH = 64
