import { createHash } from 'node:crypto';

/**
 * Onam metninin hash'i.
 *
 * `common/crypto/tokens.ts`teki `sha256` ile aynı algoritma; ayrı durmasının
 * sebebi burada hash'lenen şeyin bir SIR değil, bir BELGE olması — ikisi bir
 * gün farklı normalizasyon isteyebilir (örn. satır sonu birleştirme).
 *
 * Yazan (`ConsentService.saveDraft`) ile doğrulayan (`assertConsent`) taraf
 * AYNI fonksiyonu çağırmak zorunda: iki ayrı kopya bir gün ayrışırsa yayındaki
 * her metin sessizce reddedilmeye başlar.
 */
export function consentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
