/** DI sembolü — `@Inject(OBJECT_STORAGE)`. */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface ObjectMetadata {
  sizeBytes: number;
  contentType: string | null;
  /** S3 ETag'i; çok parçalı yüklemede içerik hash'i DEĞİLDİR, bütünlük için kullanılmaz. */
  etag: string | null;
}

/**
 * Nesne deposu arayüzü.
 *
 * Dosya içeriği API sürecinden GEÇMEZ: istemci imzalı URL ile doğrudan S3'e
 * yükler, sunucu yalnız üstveriyi doğrular. Bu yüzden arayüzde `upload` yok —
 * `presignPut` ve `head` var.
 */
export interface ObjectStorage {
  /** İstemcinin doğrudan PUT edeceği imzalı URL. */
  presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
  /** Süreli indirme URL'i. */
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
  /** Nesne yoksa `undefined`. Yükleme gerçekten olmuş mu, boyutu doğru mu — buradan doğrulanır. */
  head(key: string): Promise<ObjectMetadata | undefined>;
  /** Thumbnail üretimi için: worker nesneyi indirir. */
  get(key: string): Promise<Buffer | undefined>;
  /** Worker'ın ürettiği küçük görseli yazar. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}
