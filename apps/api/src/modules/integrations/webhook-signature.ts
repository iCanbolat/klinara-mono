import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * `X-Hub-Signature-256` doğrulaması.
 *
 * ⚠️ İmza gövdenin HAM BAYTLARI üzerinden hesaplanır. JSON parse edilip
 * yeniden serialize edilmiş bir gövde — alan sırası, boşluk, unicode kaçışı
 * değiştiği için — FARKLI bir imza üretir ve doğrulama sessizce başarısız
 * olur. Bu yüzden uygulama `rawBody: true` ile kurulur ve buraya `Buffer`
 * geçilir; `string` alan bir imza fonksiyonu, ilk refactor'da parse edilmiş
 * gövdeyle çağrılmaya davetiye çıkarırdı.
 *
 * Karşılaştırma `timingSafeEqual` ile yapılır: `===` ile karşılaştırmak,
 * imzayı bayt bayt tahmin etmeye açık bir zamanlama kanalı bırakır.
 */
export function verifyHubSignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (header === undefined || !header.startsWith('sha256=')) return false;

  const provided = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}
