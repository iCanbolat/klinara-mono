package com.klinara.android.services.crm

import com.klinara.android.services.formatting.SearchText
import com.klinara.android.services.networking.InstantSerializer
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant

/**
 * Müşterinin geliş kaynağı.
 *
 * [Unknown] dalı zorunlu: sunucuya yarın eklenecek bir kaynak (`tiktok`, `referral_v2`…)
 * müşteri listesinin TAMAMINI çözümleme hatasıyla düşürmemeli. Randevu durumundaki
 * (`AppointmentStatus`) kararın aynısı.
 */
@Serializable(with = CustomerSourceSerializer::class)
enum class CustomerSource(val wire: String) {
    WalkIn("walk_in"),
    Referral("referral"),
    Instagram("instagram"),
    Google("google"),
    Website("website"),
    WhatsApp("whatsapp"),
    Other("other"),

    /** Sunucu tanımadığımız bir kaynak gönderdi. */
    Unknown("unknown"),
    ;

    val turkishName: String
        get() =
            when (this) {
                WalkIn -> "Kapıdan geldi"
                Referral -> "Tavsiye"
                Instagram -> "Instagram"
                Google -> "Google"
                Website -> "Web sitesi"
                WhatsApp -> "WhatsApp"
                Other -> "Diğer"
                Unknown -> "Bilinmeyen kaynak"
            }

    companion object {
        fun from(wire: String): CustomerSource = entries.firstOrNull { it.wire == wire } ?: Unknown

        /** Kullanıcıya SEÇTİRİLEBİLECEK kaynaklar — [Unknown] bir seçenek değildir. */
        val selectable: List<CustomerSource> = entries.filter { it != Unknown }
    }
}

internal object CustomerSourceSerializer : KSerializer<CustomerSource> {
    override val descriptor = PrimitiveSerialDescriptor("CustomerSource", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): CustomerSource = CustomerSource.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: CustomerSource,
    ) = encoder.encodeString(value.wire)
}

/** Cinsiyet. Sunucu kolonu nullable DEĞİL — bu yüzden `PATCH` ile temizlenemez. */
@Serializable(with = CustomerGenderSerializer::class)
enum class CustomerGender(val wire: String) {
    Female("female"),
    Male("male"),
    Other("other"),
    Undisclosed("undisclosed"),

    /** Sunucu tanımadığımız bir değer gönderdi. */
    Unknown("unknown"),
    ;

    val turkishName: String
        get() =
            when (this) {
                Female -> "Kadın"
                Male -> "Erkek"
                Other -> "Diğer"
                Undisclosed -> "Belirtilmedi"
                Unknown -> "Bilinmeyen"
            }

    companion object {
        fun from(wire: String): CustomerGender = entries.firstOrNull { it.wire == wire } ?: Unknown

        val selectable: List<CustomerGender> = entries.filter { it != Unknown }
    }
}

internal object CustomerGenderSerializer : KSerializer<CustomerGender> {
    override val descriptor = PrimitiveSerialDescriptor("CustomerGender", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): CustomerGender = CustomerGender.from(decoder.decodeString())

    override fun serialize(
        encoder: Encoder,
        value: CustomerGender,
    ) = encoder.encodeString(value.wire)
}

/**
 * Müşteri etiketi — KİRACI kapsamlıdır, şube değil.
 *
 * Kartta seçilir, **Yönetim'de tanımlanır**: kiracı kapsamlı bir kavramı her karttan
 * yaratmaya izin vermek, birbirinden biraz farklı yazılmış üç "VIP" demekti.
 */
@Serializable
data class CustomerTag(
    val id: String,
    val name: String,
    /** `#RRGGBB` ya da null. Bozuk değer ekranda nötr tona düşer, çökmez. */
    val color: String? = null,
)

/**
 * Müşteri kartı — `CustomerResponseDto`.
 *
 * A3.3'te bu model bilerek **kırpıktı** (yalnız ad ve telefon): randevu detayının
 * ihtiyacı o kadardı ve bugün okunmayan alanları modellemek, kullanılmamış bir
 * sözleşmeyi bakım yüküne çevirmek olurdu. A4.1 kartın tamamını açıyor.
 *
 * **Sağlık verisi burada YOK** ve olmayacak: klinik notu ve dosyalar
 * `customer.medical:*` izniyle kapılı ayrı uçlardan gelir (A4.3, A4.4). [notes] bunun
 * istisnası değil — o kartın serbest not alanı, klinik kayıt değil.
 *
 * **Müşteri KİRACI kapsamlıdır, şube değil.** `X-Branch-Id` bu uçlarda anlamsızdır
 * (istemci yine de gönderir, tek yerden eklendiği için).
 */
@Serializable
data class Customer(
    val id: String,
    val fullName: String,
    val phone: String? = null,
    val email: String? = null,
    /**
     * ⚠️ Çıplak bir `"YYYY-MM-DD"` STRING'dir, an değil. `Instant`'a çevirmek gün
     * kaydırır: doğum günü bir takvim günüdür, bir zaman damgası değil.
     */
    val birthDate: String? = null,
    val gender: CustomerGender? = null,
    /** Kartın serbest notu. Klinik not DEĞİL — o `customer.medical:*` ile kapılı. */
    val notes: String? = null,
    val addressLine: String? = null,
    val district: String? = null,
    val city: String? = null,
    val postalCode: String? = null,
    val source: CustomerSource? = null,
    /** Bu kayıt birleştirildiyse hayatta kalan kaydın kimliği. */
    val mergedIntoCustomerId: String? = null,
    val tags: List<CustomerTag> = emptyList(),
    @Serializable(with = InstantSerializer::class)
    val createdAt: Instant? = null,
) {
    /** "Bağdat Cad. 12, Kadıköy, İstanbul" — boş parçalar atlanır, virgül birikmez. */
    val addressSummary: String?
        get() =
            listOfNotNull(addressLine, district, city)
                .filter { it.isNotBlank() }
                .takeIf { it.isNotEmpty() }
                ?.joinToString(", ")

    /** Bu kayıt bir başkasına birleştirilmiş mi? */
    val isMerged: Boolean get() = mergedIntoCustomerId != null

    /**
     * Yerel eşleşme — sunucudaki `klinara_fold_tr()` ile **aynı haritayı** taşır.
     *
     * Sunucu araması bunun yerini almaz, tamamlar: elde ZATEN olan bir kaydı süzen
     * yerler (randevu akışındaki seçici) için. Liste araması sunucuya gider.
     */
    fun matches(term: String): Boolean =
        SearchText.matches(fullName, term) || SearchText.matchesDigits(phone, term)
}
