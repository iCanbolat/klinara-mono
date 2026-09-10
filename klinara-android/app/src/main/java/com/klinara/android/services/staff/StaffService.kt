package com.klinara.android.services.staff

/**
 * Personel uçları.
 *
 * Doküman `staff`'ı A7.2'ye koyuyor ama takvim personel adı ve rengi olmadan
 * çizilemez (filtre çipleri, blok aksanı, ajanda satırı). Bu yüzden servisin
 * **okuma yarısı** A3.1'e alındı; A7.2 yazma metotlarını ekler.
 *
 * Boş arayüz kuralı korunuyor: tek metot, gerçek bir çağıran, kendi mock'u.
 */
interface StaffService {
    /** `GET staff` — kiracının tüm personeli. Sunucu şubeye göre daraltmıyor. */
    suspend fun list(): List<StaffProfile>
}
