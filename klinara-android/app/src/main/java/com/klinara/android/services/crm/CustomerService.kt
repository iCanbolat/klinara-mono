package com.klinara.android.services.crm

import com.klinara.android.services.networking.Page

/**
 * Müşteri uçları.
 *
 * **Müşteri KİRACI kapsamlıdır, şube değil.** `X-Branch-Id` bu uçlarda anlamsız; istemci
 * yine de gönderir çünkü başlık tek yerden ekleniyor (§5.4) ve bir uçta unutulması
 * mümkün olmasın diye orası bilerek koşulsuz.
 *
 * A3.3 [get]'i, A3.4 [search]'ü öne almıştı — ikisi de gerçek çağıranıyla geldi.
 * A4.1 [list] ile gezinmeyi açıyor.
 */
interface CustomerService {
    /**
     * `GET customers?limit&cursor&tagId&source`
     *
     * Cursor **opaktır**: ayrıştırılmaz, saklanır ve aynen geri gönderilir. Sunucu
     * `(createdAt, id)` üzerinde keyset kullanıyor ama bu bir uygulama detayıdır ve
     * istemci ona bel bağlarsa sunucu sıralamayı değiştiremez hâle gelir.
     */
    suspend fun list(query: CustomerListQuery = CustomerListQuery()): Page<Customer>

    /** `GET customers/:id` */
    suspend fun get(id: String): Customer

    /**
     * `GET customers/search?q=`
     *
     * ⚠️ Bu uç **çıplak dizi** döndürür — `{ data: [...] }` zarfı YOK. Sözleşmede
     * bunun bir tek eşi var (`GET customers/:id/opt-out`); zarf beklemek HER çağrıda
     * sessiz bir çözümleme hatası verirdi ve iOS'ta tam olarak bu yaşandı.
     *
     * Sunucu `q ≥ 2` istiyor; daha kısa terimle **hiç çağrılmamalı** (çağıran
     * tarafta eşik var, burada değil — servis sözleşmeyi taşır, kullanıcı arayüzü
     * kararını değil).
     *
     * **Sayfalanmıyor** ve bu bilinçli: arama bir gezinme değil, bir daraltmadır.
     */
    suspend fun search(
        query: String,
        limit: Int? = null,
    ): List<Customer>

    /** `POST customers` — `customer:write`. Telefon sunucuda E.164'e normalize edilir. */
    suspend fun create(input: CreateCustomerInput): Customer

    /**
     * `PATCH customers/:id` — `customer:write`.
     *
     * Gövde ÜÇ durumlu ([Patch]): gönderilmeyen alan korunur, açık `null` **siler**.
     */
    suspend fun update(
        id: String,
        input: UpdateCustomerInput,
    ): Customer

    /**
     * `DELETE customers/:id` — `customer:write`.
     *
     * **Silme değil arşivlemedir** ve arşivlenen kaydı GERİ DÖNDÜRÜR. Telefon numarası
     * serbest kalır; ikinci bir `DELETE` `404` verir.
     */
    suspend fun archive(id: String): Customer

    /**
     * `PUT customers/:id/tags` — `customer:write`.
     *
     * **Tam değiştirmedir**: gönderilmeyen etiket SİLİNİR. Çağıran her zaman mevcut tam
     * listeyi okuyup göndermeli.
     */
    suspend fun replaceTags(
        customerId: String,
        tagIds: List<String>,
    ): Customer

    /** `GET customer-tags` — zarfLI (`{ data: [...] }`), aramanın aksine. */
    suspend fun tags(): List<CustomerTag>

    /** `POST customer-tags` — katlanmış ad çakışırsa `409`. */
    suspend fun createTag(
        name: String,
        color: String?,
    ): CustomerTag

    /** `PATCH customer-tags/:id` */
    suspend fun updateTag(
        id: String,
        name: String?,
        color: Patch<String>,
    ): CustomerTag

    /** `DELETE customer-tags/:id` — 204. Atamalar da düşer. */
    suspend fun deleteTag(id: String)

    /**
     * `POST customers/:targetId/merge` — **`customer:merge`** (`customer:write` YETMEZ).
     *
     * Yoldaki kimlik HAYATTA KALIR, [sourceCustomerId] arşivlenir. Kendine birleştirme
     * sunucuda `400`.
     */
    suspend fun merge(
        targetCustomerId: String,
        sourceCustomerId: String,
    ): CustomerMergeResult
}

/**
 * Liste sorgusu.
 *
 * Ayrı bir tip, çünkü dört isteğe bağlı parametreyi imzada taşımak çağrı yerlerinde
 * `list(null, null, tagId, null)` gibi okunmaz satırlar üretirdi.
 */
data class CustomerListQuery(
    val limit: Int? = null,
    val cursor: String? = null,
    val tagId: String? = null,
    val source: CustomerSource? = null,
)
