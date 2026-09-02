/**
 * Idempotency anahtarının ömrü.
 *
 * Anahtar HOLD OLUŞTURULDUĞU AN üretilir ve hold yaşadığı sürece aynı kalır.
 * Gerekçe: sunucunun idempotency kaydı "aynı niyet iki kez gönderildi mi"
 * sorusunu cevaplıyor ve buradaki niyet tam olarak "şu tutulan slota randevu
 * yaz". Anahtar her gönderimde yenilenseydi çift tıklama iki randevu üretirdi;
 * hold değiştikten sonra da aynı kalsaydı yeni saat için ilk randevunun yanıtı
 * tekrar oynatılırdı.
 *
 * ⚠️ Sunucunun `IdempotencyService`i GÖVDEYİ de hash'liyor: aynı anahtarla
 * farklı gövde `IDEMPOTENCY_CONFLICT` verir. Bu yüzden form gönderim sırasında
 * KİLİTLENİYOR — kullanıcı başarısız bir denemeden sonra adını düzeltip
 * yeniden gönderemesin.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // `crypto.randomUUID` yalnız güvenli bağlamda var; http:// ile açılan bir
  // yerel adreste olmayabilir.
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
