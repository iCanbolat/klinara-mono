package com.klinara.android.services.mock

/**
 * Mock grafiğinin PAYLAŞTIĞI sabit kimlikler.
 *
 * Her servisin kendi kimliğini üretmesi, birbirini tanımayan kayıtlar demek olurdu:
 * randevu var olmayan bir müşteriye bağlanır, paket var olmayan bir hizmete. iOS'ta bu
 * bir kez yaşandı; sabit kimlikler o hatanın yapısal çözümü.
 */
object MockIds {
    const val TENANT_NISANTASI = "7f3d1a20-0000-4000-8000-000000000001"
    const val TENANT_BODRUM = "7f3d1a20-0000-4000-8000-000000000002"

    const val BRANCH_NISANTASI = "b1000000-0000-4000-8000-000000000001"
    const val BRANCH_BODRUM = "b1000000-0000-4000-8000-000000000002"

    const val USER_MANAGER = "u1000000-0000-4000-8000-000000000001"

    // --- A7.2: personel profillerinin kullanıcıları ---
    //
    // A3.1'de üç profil de USER_MANAGER'a bağlıydı; sunucu bir kullanıcıya TEK profil
    // tanıyor (409). Oturumdaki yönetici (Ayşe) ve resepsiyon (Elif) profilsiz: personel
    // oluşturma ekranının aday listesi ancak böyle boş değil.
    const val USER_DERYA = "u1000000-0000-4000-8000-000000000011"
    const val USER_MERVE = "u1000000-0000-4000-8000-000000000012"
    const val USER_ONUR = "u1000000-0000-4000-8000-000000000013"
    const val USER_RECEPTION = "u1000000-0000-4000-8000-000000000014"

    // --- A3.1: takvim grafiği ---
    //
    // Personel, müşteri ve hizmet kimlikleri BURADA duruyor çünkü üç ayrı mock servis
    // (staff, booking, ileride catalog) aynı kayıtlara atıfta bulunuyor. Her servisin
    // kendi kimliğini üretmesi, var olmayan bir personele bağlı bir randevu demekti.

    const val STAFF_DERYA = "51a11000-0000-4000-8000-000000000001"
    const val STAFF_MERVE = "51a11000-0000-4000-8000-000000000002"
    const val STAFF_ONUR = "51a11000-0000-4000-8000-000000000003"

    val STAFF_ALL = listOf(STAFF_DERYA, STAFF_MERVE, STAFF_ONUR)

    const val SERVICE_SKIN_CARE = "5e111ce0-0000-4000-8000-000000000001"
    const val SERVICE_LASER = "5e111ce0-0000-4000-8000-000000000002"
    const val SERVICE_FILLER = "5e111ce0-0000-4000-8000-000000000003"
    const val SERVICE_CHECKUP = "5e111ce0-0000-4000-8000-000000000004"
    const val SERVICE_MASK = "5e111ce0-0000-4000-8000-000000000005"

    // --- A7.1: katalog kategorileri ---
    //
    // İlki A3.4'ten beri tek kategori kimliğiydi (hepsi oradaydı); korunuyor ki eski bir
    // mock kaydı kategorisiz kalmasın.

    const val CATEGORY_SKIN_CARE = "ca7e0000-0000-4000-8000-000000000001"
    const val CATEGORY_EPILATION = "ca7e0000-0000-4000-8000-000000000002"
    const val CATEGORY_INJECTION = "ca7e0000-0000-4000-8000-000000000003"
}
