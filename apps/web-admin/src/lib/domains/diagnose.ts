import type { MessageKey } from '@/i18n/tr';

/**
 * Sunucunun `failureReason` metnini kullanıcının YAPABİLECEĞİ bir şeye çevirir.
 *
 * Ham sebep gösterilmeye devam ediyor (destek için gerekli) ama tek başına
 * eyleme dönüşmüyor: "TXT record not found" bir kullanıcıya ne yapması
 * gerektiğini söylemez, "kaydı eklediyseniz yayılım bir saat sürebilir" söyler.
 */
export function diagnose(failureReason: string | null): MessageKey {
  if (failureReason === null || failureReason === '') return 'domains.diagnose.unknown';
  const reason = failureReason.toLowerCase();
  if (reason.includes('txt')) return 'domains.diagnose.txtMissing';
  if (reason.includes('cname') || reason.includes('target')) return 'domains.diagnose.cnameMismatch';
  if (reason.includes('nxdomain') || reason.includes('not found') || reason.includes('bulunamadı')) {
    return 'domains.diagnose.propagating';
  }
  return 'domains.diagnose.unknown';
}
