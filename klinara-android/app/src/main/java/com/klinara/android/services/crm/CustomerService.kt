package com.klinara.android.services.crm

/**
 * Müşteri uçları.
 *
 * Doküman `customers`'ı A4.1'e koyuyor; **okuma yarısının bir metodu** A3.3'e alındı:
 * `AppointmentResponseDto` müşteri ADINI taşımıyor (takvim satırı taşıyor, detay
 * yanıtı taşımıyor) ve müşterisi yazmayan bir randevu detayı işe yaramaz.
 *
 * Alternatif, adı gezinme argümanı olarak taşımaktı — ama o, bir ekranın gerçeğini
 * başka bir ekranın hafızasına bağlamak ve bayatlamaya davetiye çıkarmak olurdu.
 * A3.4 `search`'ü, A4.1 kartın tamamını ekler.
 */
interface CustomerService {
    /** `GET customers/:id` */
    suspend fun get(id: String): Customer

    /**
     * `GET customers/search?q=`
     *
     * ⚠️ Bu uç **çıplak dizi** döndürür — `{ data: [...] }` zarfı YOK. Tek istisna
     * budur ve zarf beklemek sessiz bir çözümleme hatası verirdi.
     */
    suspend fun search(query: String): List<Customer>
}
