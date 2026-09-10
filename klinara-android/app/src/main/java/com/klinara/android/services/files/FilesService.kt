package com.klinara.android.services.files

/**
 * Dosya uçları.
 *
 * Akış **üç adımlıdır** ve sırası sunucunun kuralıdır:
 * `presign` → istemci imzalı URL'ye **doğrudan PUT** → `confirm`.
 *
 * **`presign` veritabanına HİÇBİR ŞEY yazmaz**: yükleme yarıda kalırsa geriye asılı
 * bir "pending" satır kalmasın. Kayıt `confirm` adımında, nesnenin gerçekten var
 * olduğu doğrulandıktan sonra açılıyor — ve **boyut/MIME nesnenin KENDİSİNDEN**
 * okunuyor, istemcinin beyanından değil.
 */
interface FilesService {
    /** `POST uploads/presign` — `customer:write`. DB'ye yazmaz. */
    suspend fun presign(
        customerId: String,
        contentType: String,
        sizeBytes: Long,
        kind: FileKind,
    ): PresignUpload

    /** `POST customers/:id/files` — nesne doğrulandıktan sonra kaydı açar. */
    suspend fun confirm(
        customerId: String,
        storageKey: String,
        kind: FileKind,
        position: FilePosition = FilePosition.Other,
        groupId: String? = null,
        sha256: String? = null,
    ): CustomerFile

    /** `GET customers/:id/files` — `customer:read`. */
    suspend fun files(customerId: String): List<CustomerFile>

    /** `GET customers/:id/file-groups` */
    suspend fun groups(customerId: String): List<FileGroup>

    /** `POST customers/:id/file-groups` */
    suspend fun createGroup(
        customerId: String,
        title: String,
        bodyArea: String? = null,
        serviceId: String? = null,
    ): FileGroup

    /**
     * `GET files/:id/download-url?variant=`
     *
     * ⚠️ **HER çağrı `customer_record_access_log`'a satır atar** (KVKK). Adres liste
     * render'ında çekilirse bir kaydırma onlarca sahte "görüntüledi" kaydı üretir ve
     * erişim kaydının değeri sıfırlanır — "kim hangi kaydı gördü" artık cevaplanamaz.
     * Bu yüzden adres **yalnız kullanıcı eylemi** tetiklediğinde çekilir.
     *
     * `variant=thumb` hazır değilse **`409`** döner; istemci tam boyuta DÜŞMEZ.
     */
    suspend fun downloadUrl(
        fileId: String,
        variant: FileVariant = FileVariant.Original,
    ): DownloadUrl

    /** `DELETE files/:id` — arşivler; nesne depoda kalır (saklama yükümlülüğü). */
    suspend fun delete(fileId: String)
}
