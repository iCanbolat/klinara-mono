package com.klinara.android.services.mock

/**
 * Mock müşteri tablosu — randevu tohumu ile müşteri servisinin PAYLAŞTIĞI kaynak.
 *
 * Daha önce bu liste `MockBookingSeed`'in içindeydi ve yalnız ad/telefon üretiyordu.
 * `CustomerService` gelince aynı kişilerin iki yerde yaşaması gerekirdi; ayrı
 * tohumlanmış kopyalar, detay ekranında takvimde görünenden BAŞKA bir müşteri adı
 * göstermeye kadar giderdi (iOS'ta bir kez yaşanan sınıftan hata).
 *
 * Kimlikler indeksten türetiliyor ve `MockBookingSeed` aynı formülü kullanmıyor —
 * **buradaki [id] tek kaynak**.
 */
object MockCustomers {
    data class Row(
        val id: String,
        val fullName: String,
        val phone: String?,
    )

    /**
     * Kimlik LİSTE SIRASINDAN türetilir, elle yazılmaz: iki satıra aynı indeksi vermek
     * iki müşteriyi tek kimlikte birleştirir ve bunu ancak randevular karışınca fark
     * ederdik.
     */
    val ALL: List<Row> =
        listOf(
            "Ayşe Yılmaz" to "+905321112233",
            "Zeynep Kaya" to "+905321112234",
            "Elif Demir" to null,
            "Fatma Şahin" to "+905321112236",
            "Mehmet Aslan" to "+905321112237",
            "Selin Arslan" to "+905321112238",
            "Can Öztürk" to null,
            "Deniz Yıldız" to "+905321112240",
            "Burcu Çelik" to "+905321112241",
            "Kerem Doğan" to "+905321112242",
        ).mapIndexed { index, (fullName, phone) ->
            Row(id = "c0570000-0000-4000-8000-%012d".format(index + 1), fullName = fullName, phone = phone)
        }

    fun at(index: Int): Row = ALL[index % ALL.size]

    fun byId(id: String): Row? = ALL.firstOrNull { it.id == id }
}
