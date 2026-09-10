package com.klinara.android.services.files

import com.klinara.android.services.contracts.ApiErrorCode
import com.klinara.android.services.mock.Fixtures
import com.klinara.android.services.networking.KlinaraJson
import com.klinara.android.services.networking.ListEnvelope
import com.klinara.android.services.networking.ProblemDetails
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

class FileModelsTest {
    private fun <T> decode(
        path: String,
        deserializer: kotlinx.serialization.DeserializationStrategy<T>,
    ): T = KlinaraJson.decodeFromString(deserializer, Fixtures.read(path))

    @Test
    @DisplayName("`presign` yanıtı çözülüyor — anahtar SUNUCUDA üretiliyor")
    fun presignDecodes() {
        val ticket = decode("files/presign-upload.json", PresignUpload.serializer())

        assertTrue(ticket.storageKey.contains("/"))
        assertEquals("image/jpeg", ticket.contentType)
        assertNotNull(ticket.expiresAt)
    }

    @Test
    @DisplayName("Yeni yüklenen dosyada küçük görsel HENÜZ YOK")
    fun freshFileHasNoThumbnail() {
        val file = decode("files/customer-file.json", CustomerFile.serializer())

        assertEquals(FileKind.Photo, file.kind)
        assertEquals(FilePosition.Before, file.position)
        // Kuyruk işi birkaç saniye sürüyor; ekran yer tutucu çizmeli.
        assertFalse(file.hasThumbnail)
        assertEquals(1_843_200L, file.sizeBytes)
    }

    @Test
    @DisplayName("Grup çözülüyor ve konuma göre dosya bulunabiliyor")
    fun groupDecodes() {
        val groups = decode("files/file-group.json", ListEnvelope.serializer(FileGroup.serializer())).data
        val group = groups.first()

        assertEquals("Sağ kol — 3. seans", group.title)
        assertNotNull(group.file(FilePosition.Before))
        // Boş slot null döner — ekran "fotoğraf ekle" çizecek.
        assertNull(group.file(FilePosition.After))
    }

    @Test
    @DisplayName("Hazır olmayan küçük görselin 409'u çözülüyor")
    fun thumbNotReadyProblemDecodes() {
        val problem = decode("files/problem-thumb-not-ready.json", ProblemDetails.serializer())

        assertEquals(ApiErrorCode.CONFLICT, problem.code)
        assertEquals(409, problem.status)
    }

    @Test
    @DisplayName("SVG beyaz listede YOK — çalıştırılabilir içerik taşır")
    fun svgIsNotAllowed() {
        assertFalse(FileContentType.isAllowed("image/svg+xml"))
        assertTrue(FileContentType.isAllowed(FileContentType.JPEG))
        assertTrue(FileContentType.isAllowed(FileContentType.PDF))
    }

    @Test
    @DisplayName("Tip SİHİRLİ BAYTTAN tespit ediliyor — uzantı ikinci sırada")
    fun typeIsDetectedFromMagicBytes() {
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte()) + ByteArray(16)
        val png =
            byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) + ByteArray(16)
        val pdf = "%PDF-1.7".toByteArray() + ByteArray(16)

        assertEquals(FileContentType.JPEG, FileContentType.detect(jpeg))
        assertEquals(FileContentType.PNG, FileContentType.detect(png))
        assertEquals(FileContentType.PDF, FileContentType.detect(pdf))

        // `.jpg` diye adlandırılmış bir PDF, PDF'tir. Uzantıya güvenmek, sunucunun
        // reddedeceği bir nesneyi depoya yazmaya çalışmak olurdu.
        assertEquals(FileContentType.PDF, FileContentType.detect(pdf, fileExtension = "jpg"))
    }

    @Test
    @DisplayName("Bilinmeyen içerik null döner — varsayılan tip ATANMAZ")
    fun unknownContentGetsNoDefault() {
        val garbage = ByteArray(32) { 0x42 }

        // Tanımadığımız bir dosyayı JPEG sanmak, yükleme sınırını ve sunucunun
        // beyaz listesini istemcide sessizce delmek olurdu.
        assertNull(FileContentType.detect(garbage))
        assertNull(FileContentType.detect(garbage, fileExtension = "exe"))
    }

    @Test
    @DisplayName("WEBP ve HEIC imzaları OFFSETLİ okunuyor")
    fun offsetSignaturesAreRead() {
        val webp = "RIFF".toByteArray() + ByteArray(4) + "WEBP".toByteArray() + ByteArray(8)
        val heic = ByteArray(4) + "ftyp".toByteArray() + "heic".toByteArray() + ByteArray(8)

        assertEquals(FileContentType.WEBP, FileContentType.detect(webp))
        assertEquals(FileContentType.HEIC, FileContentType.detect(heic))
    }

    @Test
    @DisplayName("Boyut sınırı sunucununkiyle aynı: 25 MB")
    fun sizeLimitMatchesTheServer() {
        assertEquals(25L * 1024 * 1024, FileContentType.MAX_BYTES)
    }
}
