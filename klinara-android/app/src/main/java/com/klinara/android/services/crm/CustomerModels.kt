package com.klinara.android.services.crm

import kotlinx.serialization.Serializable

/**
 * Müşteri kartı — `CustomerResponseDto` (kırpılmış).
 *
 * Sunucu bundan çok daha fazlasını gönderiyor (adres, kaynak, doğum tarihi, cinsiyet…);
 * A3.3'ün ihtiyacı **ad ve telefon**. `ignoreUnknownKeys` gerisini sessizce atıyor ve
 * A4.1 kartın tamamını modelleyecek. Bugün okunmayan alanları modellemek, kullanılmamış
 * bir sözleşmeyi bakım yüküne çevirmek olurdu.
 *
 * **Sağlık verisi burada YOK** ve olmayacak: klinik notu ve dosyalar `customer.medical:*`
 * izniyle kapılı ayrı uçlardan gelir (A4.3).
 */
@Serializable
data class Customer(
    val id: String,
    val fullName: String,
    val phone: String? = null,
    val email: String? = null,
)
