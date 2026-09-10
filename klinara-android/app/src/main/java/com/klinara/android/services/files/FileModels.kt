package com.klinara.android.services.files

import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant

/**
 * Dosya türü.
 *
 * **[Photo] sağlık verisidir** (KVKK m.6) ve `customer.medical:*` iznine bağlıdır;
 * [Document] (kimlik fotokopisi, sözleşme) `customer:*` iznine. Ayrım sunucuda
 * `customer_files.kind` üzerinden yapılıyor ve istemci de aynı ayrımı çizmek zorunda —
 * bir klinik fotoğrafı belge gibi göstermek, izin kapısını delmek olurdu.
 */
@Serializable(with = FileKindSerializer::class)
enum class FileKind(val wire: String) {
    Photo("photo"),
    Document("document"),
    Unknown("unknown"),
    ;

    val turkishName: String
        get() =
            when (this) {
                Photo -> "Fotoğraf"
                Document -> "Belge"
                Unknown -> "Bilinmeyen"
            }

    companion object {
        fun from(wire: String): FileKind = entries.firstOrNull { it.wire == wire } ?: Unknown
    }
}

internal object FileKindSerializer : KSerializer<FileKind> {
    override val descriptor = PrimitiveSerialDescriptor("FileKind", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): FileKind = FileKind.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: FileKind,
    ) = encoder.encodeString(value.wire)
}

/** Öncesi/sonrası konumu. */
@Serializable(with = FilePositionSerializer::class)
enum class FilePosition(val wire: String) {
    Before("before"),
    After("after"),
    Other("other"),
    ;

    val turkishName: String
        get() =
            when (this) {
                Before -> "Öncesi"
                After -> "Sonrası"
                Other -> "Diğer"
            }

    companion object {
        fun from(wire: String): FilePosition = entries.firstOrNull { it.wire == wire } ?: Other
    }
}

internal object FilePositionSerializer : KSerializer<FilePosition> {
    override val descriptor = PrimitiveSerialDescriptor("FilePosition", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): FilePosition = FilePosition.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: FilePosition,
    ) = encoder.encodeString(value.wire)
}

/**
 * İndirilecek nesnenin hangi hâli.
 *
 * ⚠️ [Thumb] **yalnız fotoğraflarda ve küçük görsel üretildikten SONRA** anlamlı.
 * Hazır değilken sunucu `409` döner ve istemci **tam boyuta DÜŞMEZ**: sessiz düşüş,
 * 30 fotoğraflı bir ızgaranın farkında olmadan 25 MB'lık nesneler indirmesi demekti.
 */
enum class FileVariant(val wire: String) {
    Original("original"),
    Thumb("thumb"),
}

/**
 * İzin verilen içerik tipleri — **beyaz liste, kara liste değil**.
 *
 * `image/svg+xml` bilinçle YOK: SVG çalıştırılabilir içerik taşır. Yarın eklenecek bir
 * tipin sessizce geçmesi yerine açıkça eklenmesi gerekiyor.
 */
object FileContentType {
    const val JPEG = "image/jpeg"
    const val PNG = "image/png"
    const val WEBP = "image/webp"
    const val HEIC = "image/heic"
    const val PDF = "application/pdf"

    val allowed: List<String> = listOf(JPEG, PNG, WEBP, HEIC, PDF)

    /** Sunucunun `UPLOAD_MAX_BYTES` sınırı. */
    const val MAX_BYTES: Long = 25L * 1024 * 1024

    fun isAllowed(contentType: String): Boolean = contentType in allowed

    fun turkishName(contentType: String): String =
        when (contentType) {
            JPEG -> "JPEG görsel"
            PNG -> "PNG görsel"
            WEBP -> "WebP görsel"
            HEIC -> "HEIC görsel"
            PDF -> "PDF belge"
            else -> "Bilinmeyen tür"
        }

    /**
     * İçerik tipini **SİHİRLİ BAYTTAN** tespit eder; uzantı yalnız ikinci sırada.
     *
     * Uzantıya güvenmek, `.jpg` diye adlandırılmış bir SVG'yi kabul etmek olurdu.
     * Bilinmeyen içerik `null` döner ve **varsayılan tip ATANMAZ**: tanımadığımız bir
     * dosyayı JPEG sanıp yüklemek, sunucunun reddedeceği bir nesneyi depoya yazmaktı.
     */
    fun detect(
        data: ByteArray,
        fileExtension: String? = null,
    ): String? {
        fromMagicBytes(data)?.let { return it }
        return fileExtension?.lowercase()?.let { ext ->
            when (ext) {
                "jpg", "jpeg" -> JPEG
                "png" -> PNG
                "webp" -> WEBP
                "heic", "heif" -> HEIC
                "pdf" -> PDF
                else -> null
            }
        }
    }

    private fun fromMagicBytes(data: ByteArray): String? {
        if (data.size < MIN_SNIFF_BYTES) return null

        if (data.startsWith(PDF_MAGIC)) return PDF
        if (data.startsWith(JPEG_MAGIC)) return JPEG
        if (data.startsWith(PNG_MAGIC)) return PNG
        // RIFF....WEBP — imza iki parçalı, 0 ve 8. offsetlerde.
        if (data.startsWith("RIFF".toByteArray()) && data.matchesAt(RIFF_TYPE_OFFSET, "WEBP".toByteArray())) {
            return WEBP
        }
        // ftyp + HEIC markası, 4. ve 8. offsetlerde.
        if (data.matchesAt(FTYP_OFFSET, "ftyp".toByteArray())) {
            val brand = String(data, HEIC_BRAND_OFFSET, HEIC_BRAND_LENGTH)
            if (brand in HEIC_BRANDS) return HEIC
        }
        return null
    }

    private fun ByteArray.startsWith(prefix: ByteArray): Boolean = matchesAt(0, prefix)

    private fun ByteArray.matchesAt(
        offset: Int,
        expected: ByteArray,
    ): Boolean {
        if (size < offset + expected.size) return false
        return expected.indices.all { this[offset + it] == expected[it] }
    }

    /** İmzalar — hepsi spesifikasyondan; sihirli sayı değil, TANIM. */
    private val PDF_MAGIC = "%PDF".toByteArray()
    private val JPEG_MAGIC = hex("FFD8FF")
    private val PNG_MAGIC = hex("89504E470D0A1A0A")

    /** Onaltılık imzayı bayta çevirir — spesifikasyondaki gösterimle aynı okunsun diye. */
    private fun hex(value: String): ByteArray =
        value.chunked(2).map { it.toInt(HEX_RADIX).toByte() }.toByteArray()

    private const val HEX_RADIX = 16

    private const val MIN_SNIFF_BYTES = 12
    private const val RIFF_TYPE_OFFSET = 8
    private const val FTYP_OFFSET = 4
    private const val HEIC_BRAND_OFFSET = 8
    private const val HEIC_BRAND_LENGTH = 4
    private val HEIC_BRANDS = setOf("heic", "heix", "hevc", "heim", "heis", "mif1", "msf1")
}

/** Müşteri dosyası. */
@Serializable
data class CustomerFile(
    val id: String,
    val customerId: String,
    val groupId: String? = null,
    val kind: FileKind = FileKind.Document,
    val position: FilePosition = FilePosition.Other,
    val mimeType: String = "",
    val sizeBytes: Long = 0,
    val sha256: String? = null,
    /** Küçük görsel HAZIR mı — kuyruk işi tamamlanınca dolar. */
    val hasThumbnail: Boolean = false,
    @Serializable(with = InstantSerializer::class)
    val takenAt: Instant? = null,
    val uploadedBy: String? = null,
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
)

/** Öncesi/sonrası grubu. */
@Serializable
data class FileGroup(
    val id: String,
    val title: String,
    val bodyArea: String? = null,
    val serviceId: String? = null,
    val files: List<CustomerFile> = emptyList(),
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
) {
    fun file(at: FilePosition): CustomerFile? = files.firstOrNull { it.position == at }
}

/** `POST uploads/presign` yanıtı. */
@Serializable
data class PresignUpload(
    val storageKey: String,
    val uploadUrl: String,
    /** PUT isteğinde AYNEN gönderilmeli — imza bunu kapsıyor. */
    val contentType: String,
    @Serializable(with = InstantSerializer::class)
    val expiresAt: Instant? = null,
)

/** `GET files/:id/download-url` yanıtı. */
@Serializable
data class DownloadUrl(
    val url: String,
    @Serializable(with = InstantSerializer::class)
    val expiresAt: Instant? = null,
)
