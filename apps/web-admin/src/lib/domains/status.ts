import type { Domain, DomainVerificationStatus } from '@klinara/shared';
import type { MessageKey } from '@/i18n/tr';

/**
 * Alan adı durumunun sunumu — saf.
 *
 * ⚠️ `dns_verified` ile `active` AYRI gösteriliyor ve bu bir ayrıntı değil:
 * DNS doğrulaması geçmek yeterli değil, `active`e terfi kenar proxy'sinin
 * GERÇEK sertifika talebinde oluyor. İkisini "doğrulandı" diye birleştirmek,
 * kullanıcının "DNS tamam ama sayfam hâlâ açılmıyor" durumunu anlamasını
 * imkânsız kılardı.
 */
export type StatusTone = 'ok' | 'warn' | 'danger' | 'info';

export interface StatusView {
  labelKey: MessageKey;
  tone: StatusTone;
  /** Rozet ikonu — renk TEK BAŞINA anlam taşımamalı. */
  icon: 'check' | 'clock' | 'alert' | 'pause';
}

const VIEWS: Record<DomainVerificationStatus, StatusView> = {
  pending: { labelKey: 'domains.status.pending', tone: 'info', icon: 'clock' },
  dns_verified: { labelKey: 'domains.status.dns_verified', tone: 'warn', icon: 'clock' },
  active: { labelKey: 'domains.status.active', tone: 'ok', icon: 'check' },
  failed: { labelKey: 'domains.status.failed', tone: 'danger', icon: 'alert' },
  disabled: { labelKey: 'domains.status.disabled', tone: 'info', icon: 'pause' },
};

export function statusView(status: DomainVerificationStatus): StatusView {
  return VIEWS[status];
}

/** Bir alan adı hâlâ ilerliyor mu — yoklamayı bu belirliyor. */
export function isSettling(domain: Domain): boolean {
  return domain.verificationStatus === 'pending' || domain.verificationStatus === 'dns_verified';
}

/** Listede yoklanacak bir şey var mı. */
export function anySettling(domains: readonly Domain[]): boolean {
  return domains.some(isSettling);
}

/**
 * Birincil yapılabilir mi.
 *
 * Sunucu `active` olmayan bir alan adını birincil yapmayı 409 ile reddediyor;
 * düğmeyi baştan devre dışı bırakmak, kullanıcıyı önlenebilir bir hataya
 * göndermemek demek.
 */
export function canMakePrimary(domain: Domain): boolean {
  return domain.verificationStatus === 'active' && !domain.isPrimary;
}

/** Platform subdomain'i silinemez — kanonik adres her zaman erişilebilir kalmalı. */
export function canRemove(domain: Domain): boolean {
  return domain.kind === 'custom';
}
