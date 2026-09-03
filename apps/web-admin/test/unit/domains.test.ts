import { describe, expect, it } from 'vitest';
import type { Domain } from '@klinara/shared';
import {
  anySettling,
  canMakePrimary,
  canRemove,
  isSettling,
  statusView,
} from '../../src/lib/domains/status';
import { MAX_POLL_MS, nextPollDelay } from '../../src/lib/domains/poll';
import { diagnose } from '../../src/lib/domains/diagnose';

function domain(overrides: Partial<Domain> = {}): Domain {
  return {
    id: 'd1',
    host: 'randevu.klinikx.com',
    kind: 'custom',
    verificationStatus: 'pending',
    isPrimary: false,
    failureReason: null,
    lastCheckedAt: null,
    verifiedAt: null,
    dnsInstructions: null,
    ...overrides,
  };
}

describe('alan adı durumu', () => {
  it('dns_verified ile active AYRI gösteriliyor', () => {
    // Birleştirmek, kullanıcının "DNS tamam ama sayfam açılmıyor" durumunu
    // anlamasını imkânsız kılardı: active'e terfi sertifika talebinde oluyor.
    expect(statusView('dns_verified').labelKey).not.toBe(statusView('active').labelKey);
    expect(statusView('dns_verified').tone).toBe('warn');
    expect(statusView('active').tone).toBe('ok');
  });

  it('her durumun İKONU var — renk tek başına anlam taşımıyor', () => {
    for (const status of ['pending', 'dns_verified', 'active', 'failed', 'disabled'] as const) {
      expect(statusView(status).icon, status).toBeTruthy();
      expect(statusView(status).labelKey, status).toBeTruthy();
    }
  });

  it('yalnız pending ve dns_verified yoklanıyor', () => {
    expect(isSettling(domain({ verificationStatus: 'pending' }))).toBe(true);
    expect(isSettling(domain({ verificationStatus: 'dns_verified' }))).toBe(true);
    expect(isSettling(domain({ verificationStatus: 'active' }))).toBe(false);
    expect(isSettling(domain({ verificationStatus: 'failed' }))).toBe(false);
    expect(isSettling(domain({ verificationStatus: 'disabled' }))).toBe(false);

    expect(anySettling([domain({ verificationStatus: 'active' })])).toBe(false);
    expect(
      anySettling([domain({ verificationStatus: 'active' }), domain({ verificationStatus: 'pending' })]),
    ).toBe(true);
    expect(anySettling([])).toBe(false);
  });

  it('birincil yapma YALNIZ active ve henüz birincil olmayanda açık', () => {
    // Sunucu diğerlerini 409 ile reddediyor; düğmeyi baştan kapatmak kullanıcıyı
    // önlenebilir bir hataya göndermemek demek.
    expect(canMakePrimary(domain({ verificationStatus: 'active' }))).toBe(true);
    expect(canMakePrimary(domain({ verificationStatus: 'active', isPrimary: true }))).toBe(false);
    expect(canMakePrimary(domain({ verificationStatus: 'dns_verified' }))).toBe(false);
    expect(canMakePrimary(domain({ verificationStatus: 'failed' }))).toBe(false);
  });

  it('platform subdomain’i SİLİNEMEZ', () => {
    // Kanonik adres her zaman erişilebilir kalmalı.
    expect(canRemove(domain({ kind: 'platform_subdomain' }))).toBe(false);
    expect(canRemove(domain({ kind: 'custom' }))).toBe(true);
  });
});

describe('yoklama takvimi', () => {
  it('geri çekiliyor: 5s → 15s → 30s', () => {
    expect(nextPollDelay(0, 0)).toBe(5_000);
    expect(nextPollDelay(1, 5_000)).toBe(15_000);
    expect(nextPollDelay(2, 20_000)).toBe(30_000);
    // Sonrası sabit — sonsuza kadar büyümüyor.
    expect(nextPollDelay(9, 60_000)).toBe(30_000);
  });

  it('beş dakika sonra DURUYOR', () => {
    // Sekmesini açık unutan kullanıcı saatlerce istek göndermemeli.
    expect(nextPollDelay(3, MAX_POLL_MS - 1)).toBe(30_000);
    expect(nextPollDelay(3, MAX_POLL_MS)).toBeNull();
    expect(nextPollDelay(3, MAX_POLL_MS + 1)).toBeNull();
  });
});

describe('başarısızlık teşhisi', () => {
  it('ham sebep EYLEME dönüştürülüyor', () => {
    expect(diagnose('TXT record not found')).toBe('domains.diagnose.txtMissing');
    expect(diagnose('CNAME points to a different target')).toBe('domains.diagnose.cnameMismatch');
    expect(diagnose('NXDOMAIN')).toBe('domains.diagnose.propagating');
  });

  it('bilinmeyen ve boş sebep genel metne düşüyor', () => {
    expect(diagnose('kozmik ışın')).toBe('domains.diagnose.unknown');
    expect(diagnose(null)).toBe('domains.diagnose.unknown');
    expect(diagnose('')).toBe('domains.diagnose.unknown');
  });
});
