import { describe, expect, it } from 'vitest';
import {
  planFromInvitationAccept,
  planFromLogin,
  type UpstreamLoginResponse,
} from '../../src/lib/session/login-step';

const NOW = 1_700_000_000_000;
const ACCESS_TOKEN = jwt({ sub: 'u1', tid: 't1', sid: 's1', exp: 1_700_000_900 });

describe('login-step — yukarı akış yanıtından oturum planı', () => {
  it('authenticated: token’lar cookie’ye, gövdeye YALNIZ süre', () => {
    const plan = planFromLogin(
      {
        status: 'authenticated',
        tokens: {
          accessToken: ACCESS_TOKEN,
          refreshToken: 'opak-yenileme',
          tokenType: 'Bearer',
          expiresIn: 900,
        },
      },
      NOW,
    );
    expect(plan.step).toEqual({ step: 'authenticated', expiresIn: 900 });
    expect(plan.access?.at).toBe(ACCESS_TOKEN);
    expect(plan.refresh?.rt).toBe('opak-yenileme');
    expect(plan.clearChallenge).toBe(true);
  });

  it('exp JWT İDDİASINDAN okunuyor, expiresIn’den türetilmiyor', () => {
    // İkisi arasındaki saat farkı, sunucunun geçersiz saydığı bir token'ı
    // istemcinin taze sanmasına yol açardı.
    const plan = planFromLogin(
      {
        status: 'authenticated',
        tokens: { accessToken: ACCESS_TOKEN, refreshToken: 'r', tokenType: 'Bearer', expiresIn: 900 },
      },
      NOW,
    );
    expect(plan.access?.exp).toBe(1_700_000_900);
    expect(plan.access?.sid).toBe('s1');
    expect(plan.access?.tid).toBe('t1');
    expect(plan.access?.uid).toBe('u1');
  });

  it('JWT iddiaları okunamazsa expiresIn’e düşülüyor', () => {
    const plan = planFromLogin(
      {
        status: 'authenticated',
        tokens: { accessToken: 'okunamaz', refreshToken: 'r', tokenType: 'Bearer', expiresIn: 60 },
        tenant: { id: 'tenant-yedek' },
      },
      NOW,
    );
    expect(plan.access?.exp).toBe(Math.floor(NOW / 1000) + 60);
    // `tid` iddiadan gelemedi — yanıtın kendi alanı yedek.
    expect(plan.access?.tid).toBe('tenant-yedek');
  });

  it('tenant_selection_required: kiracı listesi gövdede, token cookie’de', () => {
    const plan = planFromLogin(
      {
        status: 'tenant_selection_required',
        challengeToken: 'cok-gizli-challenge',
        tenants: [{ id: 't1', slug: 'klinik-x', name: 'Klinik X', roles: ['owner'] }],
      },
      NOW,
    );
    expect(plan.step).toEqual({
      step: 'tenant',
      tenants: [{ id: 't1', slug: 'klinik-x', name: 'Klinik X', roles: ['owner'] }],
    });
    // Challenge cookie'si SIR OLMAYAN bağlamı da taşıyor: kullanıcı kiracı
    // ekranını yenilerse liste kaybolmasın.
    expect(plan.challenge).toEqual({
      ct: 'cok-gizli-challenge',
      kind: 'tenant_select',
      tenants: [{ id: 't1', slug: 'klinik-x', name: 'Klinik X', roles: ['owner'] }],
    });
    expect(plan.access).toBeUndefined();
  });

  it('mfa_required: configured bayrağı taşınıyor (kurulum akışı buna bakıyor)', () => {
    const plan = planFromLogin(
      {
        status: 'mfa_required',
        challengeToken: 'ch',
        mfa: { configured: false, methods: [] },
      },
      NOW,
    );
    expect(plan.step).toEqual({ step: 'mfa', configured: false, methods: [] });
    expect(plan.challenge?.kind).toBe('mfa');
  });

  it('SIRLARIN HİÇBİRİ tarayıcıya giden gövdede geçmiyor', () => {
    // Bu testin varlık sebebi: `step` nesnesi Route Handler'dan JSON olarak
    // dönüyor ve oraya yanlışlıkla eklenen tek bir alan tüm BFF mimarisini
    // anlamsız kılar.
    const responses: UpstreamLoginResponse[] = [
      {
        status: 'authenticated',
        tokens: {
          accessToken: ACCESS_TOKEN,
          refreshToken: 'SIR-YENILEME',
          tokenType: 'Bearer',
          expiresIn: 900,
        },
      },
      { status: 'tenant_selection_required', challengeToken: 'SIR-CHALLENGE', tenants: [] },
      { status: 'mfa_required', challengeToken: 'SIR-CHALLENGE', mfa: { configured: true, methods: ['totp'] } },
    ];
    for (const response of responses) {
      const body = JSON.stringify(planFromLogin(response, NOW).step);
      expect(body, response.status).not.toContain('SIR-YENILEME');
      expect(body, response.status).not.toContain('SIR-CHALLENGE');
      expect(body, response.status).not.toContain(ACCESS_TOKEN);
    }
  });

  it('tutarsız yukarı akış yanıtı YARIM oturum bırakmıyor, patlıyor', () => {
    expect(() => planFromLogin({ status: 'authenticated' }, NOW)).toThrow(/token göndermedi/);
    expect(() => planFromLogin({ status: 'mfa_required' }, NOW)).toThrow(/challenge token/);
    expect(() => planFromLogin({ status: 'tenant_selection_required' }, NOW)).toThrow(/challenge token/);
  });

  it('davet kabulünün İKİNCİ şekli (membership_added) ayrı ele alınıyor', () => {
    // Parolası kurulu bir hesaba yalnız üyelik eklenir, oturum AÇILMAZ.
    const plan = planFromInvitationAccept({ status: 'membership_added' }, NOW);
    expect(plan.step).toEqual({ step: 'membership_added' });
    expect(plan.access).toBeUndefined();
    expect(plan.refresh).toBeUndefined();
  });

  it('davet kabulü oturum açıyorsa normal giriş planına düşüyor', () => {
    const plan = planFromInvitationAccept(
      {
        status: 'authenticated',
        tokens: { accessToken: ACCESS_TOKEN, refreshToken: 'r', tokenType: 'Bearer', expiresIn: 900 },
      },
      NOW,
    );
    expect(plan.step).toEqual({ step: 'authenticated', expiresIn: 900 });
    expect(plan.access).toBeDefined();
  });
});

/** İmzasız test JWT'si — `login-step` imzayı zaten doğrulamıyor (bilerek). */
function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256' })}.${encode(claims)}.imza`;
}
