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
}
