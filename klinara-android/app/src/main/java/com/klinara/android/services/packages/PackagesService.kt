package com.klinara.android.services.packages

import com.klinara.android.services.networking.Page

/**
 * Paket ve seans hakkı uçları (Faz A5).
 *
 * Dört alt bölüm TEK arayüzde: tanımlar (A5.1), satış ve defter (A5.2), operasyonlar
 * (A5.3), raporlar (A5.4). Sunucuda dört ayrı controller var ama istemcide hepsi aynı
 * ekran ailesini besliyor; dört arayüze bölmek her ekranı dört bağımlılık taşımaya
 * zorlardı. iOS `PackagesService` ile aynı karar ve aynı sıra.
 *
 * **İyimser kilit ve tekrar güvenliği imzada açıkça görünür:** `version` alan metotlar
 * `If-Match` gönderir, `idempotencyKey` alanlar tekrarlanan isteği ikinci bir yazıya
 * çevirmez. İkisi farklı hataları durdurur ve para/hak dokunan uçlarda birlikte kullanılır.
 * Anahtar ÇAĞIRAN ekranda üretilir ve ekran ömrü boyunca sabit kalır — her denemede yeni
 * anahtar, ağ hatası sonrası "tekrar"a basan kullanıcıya iki paket sattırırdı.
 */
interface PackagesService {
    // --- Tanımlar (A5.1) ---

    /** `GET package-definitions` — `package:read`. Cursor sayfalı. */
    suspend fun definitions(query: PackageDefinitionQuery = PackageDefinitionQuery()): Page<PackageDefinition>

    /** `GET package-definitions/:id` — `package:read`. */
    suspend fun definition(id: String): PackageDefinition

    /** `POST package-definitions` — `package:write`. Kalem fiyatları sunucuda katalogdan alınır. */
    suspend fun createDefinition(input: CreatePackageDefinitionInput): PackageDefinition

    /**
     * `PATCH package-definitions/:id` — `package:write`, `If-Match` zorunlu.
     *
     * Değişiklik **satılmış paketleri etkilemez**: satış anında alınan snapshot geçerlidir.
     */
    suspend fun updateDefinition(
        id: String,
        version: Int,
        input: UpdatePackageDefinitionInput,
    ): PackageDefinition

    /**
     * `DELETE package-definitions/:id` — `package:write`, `If-Match` zorunlu, `204`.
     *
     * Satılmamışsa ARŞİVLER, satılmışsa yalnız PASİFE alır. Hangisinin olduğunu yanıt
     * söylemiyor; çağıran kaydı yeniden çekmeli, tahmin etmemeli.
     */
    suspend fun retireDefinition(
        id: String,
        version: Int,
    )
}

/**
 * `GET package-definitions` sorgusu.
 *
 * [branchId] bir **kapsam** sorusudur, dışlama değil: şube kısıtı olmayan tanım her
 * kapsama girer (`package-definitions.repository.ts`).
 */
data class PackageDefinitionQuery(
    val cursor: String? = null,
    val limit: Int? = null,
    val branchId: String? = null,
    val serviceId: String? = null,
    val isActive: Boolean? = null,
)
