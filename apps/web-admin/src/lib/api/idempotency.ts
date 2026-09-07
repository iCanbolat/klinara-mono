/**
 * Idempotency anahtarı üretimi — `apps/web-booking/src/lib/idempotency.ts`in
 * panele taşınmış hâli.
 *
 * `lib/api/client.ts` `idempotencyKey` seçeneğini Faz 11'den beri taşıyordu
 * ama HİÇ ÇAĞRI YERİ YOKTU: editör ve alan adı yönetimi para ya da randevu
 * yazmıyor. Randevu oluşturma projede bu anahtarın ilk gerçek kullanıcısı.
 *
 * ---------------------------------------------------------------------------
 * ANAHTARIN ÖMRÜ — panelde web-booking'den FARKLI
 * ---------------------------------------------------------------------------
 * Public akışta anahtar HOLD'a bağlıydı: niyet "şu tutulan slota randevu yaz".
 * Panelde hold yok; niyet "şu formda kurulan randevuyu oluştur". Dolayısıyla
 * anahtar DİYALOG AÇILDIĞINDA üretilir ve şu iki durumda yenilenir:
 *
 *   1. Kullanıcı slotu değiştirir → farklı bir niyet, yeni anahtar.
 *   2. Randevu başarıyla oluşur ve diyalog yeniden açılır → yeni niyet.
 *
 * ⚠️ Sunucunun `IdempotencyService`i GÖVDEYİ de hash'liyor: aynı anahtarla
 * farklı gövde `IDEMPOTENCY_CONFLICT` (409) verir. Bu yüzden form gönderim
 * sırasında kilitlenmeli — kullanıcı başarısız bir denemeden sonra hizmeti
 * değiştirip aynı anahtarla yeniden gönderemesin.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // `crypto.randomUUID` yalnız GÜVENLİ BAĞLAMDA var; http:// ile açılan bir
  // yerel adreste tanımsız olabilir ve o hâlde çağrı patlardı.
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
