/**
 * API'nin giriş yanıtını, tarayıcıya inebilecek şekle çeviren SAF eşleyici.
 *
 * Bu dosya BFF mimarisinin sözleşme noktası: yukarı akış yanıtı üç sır taşıyor
 * (`accessToken`, `refreshToken`, `challengeToken`) ve bunların hiçbiri
 * tarayıcıya inmemeli. Dönüşümü Route Handler'ın içinde satır içi yapmak,
 * "bir alan daha ekleyeyim" diye yazılan bir satırın sırrı sızdırmasını
 * mümkün kılardı; burada saf bir fonksiyon olarak durduğu için sızıntı bir
 * BİRİM TESTİYLE kapatılabiliyor (`login-step.test.ts` seri hâle getirilmiş
 * gövdede token dizelerinin geçmediğini iddia ediyor).
 *
 * Çıktı iki parçalı: `step` (tarayıcıya giden gövde) ve `cookies` (Route
 * Handler'ın yazacağı mühürlü değerler). Handler'ın kendi kararı kalmıyor.
 */

import type { SessionStep, TenantOption } from '@klinara/shared';
import type { AccessPayload, ChallengePayload, RefreshPayload } from './cookies';

/** API'nin `LoginResponseDto`'sunun bizi ilgilendiren kısmı. */
export interface UpstreamLoginResponse {
  status: 'authenticated' | 'tenant_selection_required' | 'mfa_required';
  tokens?: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    /** Saniye. */
    expiresIn: number;
  };
  challengeToken?: string;
  tenants?: TenantOption[];
  mfa?: { configured: boolean; methods: string[] };
  tenant?: { id: string };
}

/** API'nin erişim JWT'sinin bizi ilgilendiren iddiaları. */
interface AccessClaims {
  sub?: unknown;
  tid?: unknown;
  sid?: unknown;
  exp?: unknown;
}

export interface SessionPlan {
  step: SessionStep;
  access?: AccessPayload;
  refresh?: RefreshPayload;
  challenge?: ChallengePayload;
  /** Challenge cookie'si silinsin mi (akış bitti ya da baştan başladı). */
  clearChallenge: boolean;
}

/**
 * JWT'nin yük kısmını DOĞRULAMADAN okur.
 *
 * İmza kontrolü BİLEREK yok ve bu bir eksik değil: token'ı biz üretmedik, az
 * önce güvendiğimiz API'den TLS üzerinden aldık ve tek yaptığımız `exp`/`sid`
 * gibi alanları cookie'ye taşımak. İmzayı doğrulayacak taraf, token'ı geri
 * gönderdiğimizde yine API. Burada imza doğrulamak, `JWT_SECRET`'ı bu
 * uygulamaya taşımak demekti — güvenlik sınırını genişletir, daraltmaz.
 */
function readAccessClaims(jwt: string): AccessClaims | null {
  const payload = jwt.split('.')[1];
  if (payload === undefined || payload === '') return null;
  try {
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return JSON.parse(new TextDecoder().decode(bytes)) as AccessClaims;
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Yukarı akış yanıtından oturum planı üret.
 *
 * @throws yanıt kendi `status`'uyla tutarsızsa. Sunucunun `authenticated`
 * deyip token göndermemesi bizim düzeltebileceğimiz bir durum değil; yarım
 * kurulmuş bir oturum bırakmaktansa 502 vermek doğru.
 */
export function planFromLogin(response: UpstreamLoginResponse, nowMs: number): SessionPlan {
  if (response.status === 'authenticated') {
    const tokens = response.tokens;
    if (tokens === undefined) {
      throw new Error('Yukarı akış `authenticated` dedi ama token göndermedi.');
    }
    const claims = readAccessClaims(tokens.accessToken);
    // `exp` iddiadan okunuyor, `expiresIn`den TÜRETİLMİYOR: ikisi arasındaki
    // saat farkı, sunucunun geçersiz saydığı bir token'ı istemcinin taze
    // sanmasına yol açardı. İddia yoksa `expiresIn`e düşülüyor.
    const exp =
      typeof claims?.exp === 'number'
        ? claims.exp
        : Math.floor(nowMs / 1000) + tokens.expiresIn;

    return {
      step: { step: 'authenticated', expiresIn: tokens.expiresIn },
      access: {
        at: tokens.accessToken,
        exp,
        sid: asString(claims?.sid),
        tid: asString(claims?.tid) || (response.tenant?.id ?? ''),
        uid: asString(claims?.sub),
      },
      refresh: {
        rt: tokens.refreshToken,
        sid: asString(claims?.sid),
        exp: Math.floor(nowMs / 1000) + 2_592_000,
      },
      clearChallenge: true,
    };
  }

  const challengeToken = response.challengeToken;
  if (challengeToken === undefined) {
    throw new Error(`Yukarı akış \`${response.status}\` dedi ama challenge token göndermedi.`);
  }

  if (response.status === 'tenant_selection_required') {
    return {
      step: { step: 'tenant', tenants: response.tenants ?? [] },
      challenge: { ct: challengeToken, kind: 'tenant_select', tenants: response.tenants ?? [] },
      clearChallenge: false,
    };
  }

  return {
    step: {
      step: 'mfa',
      configured: response.mfa?.configured ?? false,
      methods: response.mfa?.methods ?? [],
    },
    challenge: {
      ct: challengeToken,
      kind: 'mfa',
      mfaConfigured: response.mfa?.configured ?? false,
      mfaMethods: response.mfa?.methods ?? [],
    },
    clearChallenge: false,
  };
}

/**
 * Davet kabulünün İKİ yanıt şekli var ve ikincisi kolayca gözden kaçar:
 * parolası zaten kurulu bir hesaba yalnız üyelik eklenir, oturum AÇILMAZ.
 * Arayüz bu durumda kullanıcıyı girişe yönlendirmeli — aksi hâlde "davetiyeyi
 * kabul ettim ama hiçbir şey olmadı" ekranında kalır.
 */
export function planFromInvitationAccept(
  response: UpstreamLoginResponse | { status: 'membership_added' },
  nowMs: number,
): SessionPlan {
  if (response.status === 'membership_added') {
    return { step: { step: 'membership_added' }, clearChallenge: true };
  }
  return planFromLogin(response, nowMs);
}
