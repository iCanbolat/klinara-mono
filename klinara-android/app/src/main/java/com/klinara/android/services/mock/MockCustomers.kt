package com.klinara.android.services.mock

import com.klinara.android.services.crm.Customer
import com.klinara.android.services.crm.CustomerGender
import com.klinara.android.services.crm.CustomerSource
import com.klinara.android.services.crm.CustomerTag
import java.time.Instant

/**
 * Mock müşteri tablosu — randevu tohumu ile müşteri servisinin PAYLAŞTIĞI kaynak.
 *
 * Daha önce bu liste `MockBookingSeed`'in içindeydi ve yalnız ad/telefon üretiyordu.
 * `CustomerService` gelince aynı kişilerin iki yerde yaşaması gerekirdi; ayrı
 * tohumlanmış kopyalar, detay ekranında takvimde görünenden BAŞKA bir müşteri adı
 * göstermeye kadar giderdi (iOS'ta bir kez yaşanan sınıftan hata).
 *
 * **A4.1'de zenginleşti** ama şekli korundu: [Row] hâlâ TEK kaynak ve kimlikler hâlâ
 * liste sırasından türüyor. Kartın tamamı artık modellendiği için satırlar adres,
 * etiket, kaynak ve doğum tarihi de taşıyor — boş bir kart, tasarımı doğrulamaz.
 */
object MockCustomers {
    /**
     * Etiketler KİRACI kapsamlıdır ve müşterilerden ÖNCE tanımlanır — kartta seçilir,
     * Yönetim'de tanımlanır. Kimlikler `7a600000…` ("tag") öneki ile, mevcut düzene
     * uygun.
     */
    object Tags {
        val VIP = CustomerTag(id = "7a600000-0000-4000-8000-000000000001", name = "VIP", color = "#7F9A76")
        val HASSAS_CILT =
            CustomerTag(id = "7a600000-0000-4000-8000-000000000002", name = "Hassas cilt", color = "#A6483C")
        val TAKIPTE = CustomerTag(id = "7a600000-0000-4000-8000-000000000003", name = "Takipte", color = null)

        val ALL = listOf(VIP, HASSAS_CILT, TAKIPTE)
    }

    /** Sabit bir an — `Instant.now()` kullanmak testleri çalıştırıldıkları saate bağlardı. */
    private val BASE_CREATED_AT: Instant = Instant.parse("2026-09-01T09:00:00Z")
    private const val CREATED_AT_STEP_SECONDS = 3_600L

    data class Row(
        val id: String,
        val fullName: String,
        val phone: String?,
        val email: String? = null,
        val birthDate: String? = null,
        val gender: CustomerGender? = null,
        val notes: String? = null,
        val addressLine: String? = null,
        val district: String? = null,
        val city: String? = null,
        val source: CustomerSource? = null,
        val tags: List<CustomerTag> = emptyList(),
        /** Sıralama ve cursor için — sunucu `createdAt` azalan döndürüyor. */
        val createdAt: Instant = Instant.EPOCH,
    ) {
        /** Servis sınırında `Row` değil `Customer` konuşulur; mock bir kaynak, bir tip değil. */
        fun toCustomer(): Customer =
            Customer(
                id = id,
                fullName = fullName,
                phone = phone,
                email = email,
                birthDate = birthDate,
                gender = gender,
                notes = notes,
                addressLine = addressLine,
                district = district,
                city = city,
                source = source,
                tags = tags,
                createdAt = createdAt,
            )
    }

    /**
     * Kimlik LİSTE SIRASINDAN türetilir, elle yazılmaz: iki satıra aynı indeksi vermek
     * iki müşteriyi tek kimlikte birleştirir ve bunu ancak randevular karışınca fark
     * ederdik.
     *
     * `createdAt` de indeksten türüyor ve **azalan** sıra üretiyor (ilk satır en yeni),
     * çünkü sunucu listeyi öyle döndürüyor. Hepsine aynı anı vermek, cursor testini
     * anlamsız kılardı: eşit anahtarlarda keyset sayfalaması ayırt edemez.
     */
    val ALL: List<Row> =
        listOf(
            Seed("Ayşe Yılmaz", "+905321112233", "ayse.yilmaz@ornek.com", "1990-05-12", CustomerGender.Female,
                "Alerjisi yok.", "Bağdat Cad. 12", "Kadıköy", "İstanbul", CustomerSource.Instagram,
                listOf(Tags.VIP)),
            Seed("Zeynep Kaya", "+905321112234", "zeynep@ornek.com", "1985-11-03", CustomerGender.Female,
                null, "Teşvikiye Mah. 4", "Şişli", "İstanbul", CustomerSource.Referral,
                listOf(Tags.VIP, Tags.HASSAS_CILT)),
            Seed("Elif Demir", null, null, null, CustomerGender.Female,
                "Telefon vermek istemedi.", null, null, null, CustomerSource.WalkIn, emptyList()),
            Seed("Fatma Şahin", "+905321112236", "fatma.sahin@ornek.com", "1978-02-27", CustomerGender.Female,
                null, "Cumhuriyet Cad. 88", "Beşiktaş", "İstanbul", CustomerSource.Google,
                listOf(Tags.TAKIPTE)),
            Seed("Mehmet Aslan", "+905321112237", null, "1992-08-19", CustomerGender.Male,
                null, null, "Bodrum", "Muğla", CustomerSource.Website, emptyList()),
            Seed("Selin Arslan", "+905321112238", "selin@ornek.com", "1996-01-30", CustomerGender.Female,
                null, "Yalıkavak Mah. 7", "Bodrum", "Muğla", CustomerSource.WhatsApp, listOf(Tags.HASSAS_CILT)),
            Seed("Can Öztürk", null, "can.ozturk@ornek.com", null, CustomerGender.Male,
                null, null, null, null, CustomerSource.Other, emptyList()),
            Seed("Deniz Yıldız", "+905321112240", null, "2000-06-06", CustomerGender.Other,
                null, "Moda Cad. 21", "Kadıköy", "İstanbul", CustomerSource.Instagram, listOf(Tags.TAKIPTE)),
            Seed("Burcu Çelik", "+905321112241", "burcu.celik@ornek.com", "1988-09-14", CustomerGender.Female,
                null, "Nispetiye Cad. 3", "Beşiktaş", "İstanbul", CustomerSource.Referral, emptyList()),
            Seed("Kerem Doğan", "+905321112242", null, null, CustomerGender.Undisclosed,
                null, null, "Şişli", "İstanbul", CustomerSource.WalkIn, emptyList()),
        ).mapIndexed { index, seed ->
            Row(
                id = "c0570000-0000-4000-8000-%012d".format(index + 1),
                fullName = seed.fullName,
                phone = seed.phone,
                email = seed.email,
                birthDate = seed.birthDate,
                gender = seed.gender,
                notes = seed.notes,
                addressLine = seed.addressLine,
                district = seed.district,
                city = seed.city,
                source = seed.source,
                tags = seed.tags,
                createdAt = BASE_CREATED_AT.minusSeconds(index.toLong() * CREATED_AT_STEP_SECONDS),
            )
        }

    fun at(index: Int): Row = ALL[index % ALL.size]

    fun byId(id: String): Row? = ALL.firstOrNull { it.id == id }

    /** Yalnız [ALL]'ı okunur tutmak için — on satırı adlandırılmış argümanla yazmak tabloyu okunmaz kılardı. */
    private data class Seed(
        val fullName: String,
        val phone: String?,
        val email: String?,
        val birthDate: String?,
        val gender: CustomerGender?,
        val notes: String?,
        val addressLine: String?,
        val district: String?,
        val city: String?,
        val source: CustomerSource?,
        val tags: List<CustomerTag>,
    )
}
