/**
 * Oturum cookie'lerinin ŞARTNAMESİ — saf, `next/headers`'a bağımlı değil.
 *
 * Burada yalnız "hangi cookie, hangi bayraklarla" kararı var; yazma işini
 * Route Handler yapıyor. Ayrım testler için: bayrakların doğruluğu bu
 * uygulamanın en kritik güvenlik özelliği ve onu bir HTTP isteği ayağa
 * kaldırmadan, saf bir nesne karşılaştırmasıyla kanıtlayabilmek gerekiyor.
 *
 * ÜÇ COOKIE VE PATH KARARI
 *
 * `Path=/api/session` bu tasarımın en somut kazancı: en değerli iki sır
 * (yenileme token'ı ve challenge token'ı) EN AZ SAYIDA istekte taşınır. Sayfa
 * gezinmelerine, RSC yük isteklerine ve yüzlerce `/api/a/*` proxy çağrısına
 * hiç eklenmezler — yalnız onları gerçekten kullanan avuç dolusu uca giderler.
 *
 * Erişim cookie'sinin `Max-Age`'i YOK (oturum cookie'si). Süre mühürlü `exp`
 * ile zorlanıyor; tarayıcı kapanınca AT düşer ama RT kalır, yani yeniden
 * açılışta ilk istek sessizce yeniler. Bedavaya gelen bir hijyen.
 *
 * `SameSite`: AT için `Lax`, çünkü kullanıcı adres çubuğuna panel adresini
 * yapıştırdığında (üst düzey siteler arası gezinme) middleware cookie'yi
 * görmeli, yoksa gereksiz yere girişe düşer. RT ve CH için `Strict`: ikisi de
 * yalnız kendi sayfamızdan yapılan `fetch` çağrılarında lazım.
 */

import { isProduction } from '@/config/env';

export const COOKIE_NAMES = {
  access: 'klinara_admin_at',
  refresh: 'klinara_admin_rt',
  challenge: 'klinara_admin_ch',
} as const;

/** Sır taşıyan cookie'lerin taşındığı tek yol öneki. */
export const SESSION_PATH = '/api/session';

/** Challenge token'ının sunucudaki ömrü (`JWT_CHALLENGE_TTL=5m`) ile aynı. */
export const CHALLENGE_MAX_AGE_SECONDS = 300;

/** `JWT_REFRESH_TTL=30d`. */
export const REFRESH_MAX_AGE_SECONDS = 2_592_000;

/** Erişim cookie'sinin mühürlü içeriği. */
export interface AccessPayload {
  /** API'nin erişim JWT'si. Tarayıcıya ASLA inmez. */
  at: string;
  /** Unix saniye. Proaktif yenilemeyi bu tetikler. */
  exp: number;
  sid: string;
  tid: string;
  uid: string;
}

export interface RefreshPayload {
  /** Opak yenileme token'ı. */
  rt: string;
  sid: string;
  exp: number;
}

export interface ChallengePayload {
  ct: string;
  kind: 'tenant_select' | 'mfa';
  /**
   * Adımı render etmek için gereken SIR OLMAYAN bağlam.
   *
   * Cookie'de durmasının sebebi, challenge token'ıyla aynı: kullanıcı kiracı
   * seçim ekranını yenilerse ya da geri düğmesine basarsa liste kaybolmamalı.
   * İstemci belleğinde tutulsaydı her yenileme kullanıcıyı parola ekranına
   * geri atardı.
   */
  tenants?: { id: string; slug: string; name: string; roles: string[] }[];
  mfaConfigured?: boolean;
  mfaMethods?: string[];
}

/**
 * Bir cookie'nin yazılış şartnamesi.
 *
 * `httpOnly` opsiyonel DEĞİL: bu uygulamada tarayıcı JS'inin okuyabileceği bir
 * oturum cookie'si yok ve tipin bunu zorunlu kılması, birinin gelecekte
 * "küçük bir kolaylık" için istisna açmasını görünür bir karar hâline getirir.
 */
export interface CookieSpec {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax' | 'strict';
  path: string;
  maxAge?: number;
}

function base(name: string, value: string): Pick<CookieSpec, 'name' | 'value' | 'httpOnly' | 'secure'> {
  return { name, value, httpOnly: true, secure: isProduction };
}

export function accessCookie(sealed: string): CookieSpec {
  // `maxAge` BİLEREK yok — oturum cookie'si. Gerçek süre mühürlü `exp`te.
  return { ...base(COOKIE_NAMES.access, sealed), sameSite: 'lax', path: '/' };
}

export function refreshCookie(sealed: string): CookieSpec {
  return {
    ...base(COOKIE_NAMES.refresh, sealed),
    sameSite: 'strict',
    path: SESSION_PATH,
    maxAge: REFRESH_MAX_AGE_SECONDS,
  };
}

export function challengeCookie(sealed: string): CookieSpec {
  return {
    ...base(COOKIE_NAMES.challenge, sealed),
    sameSite: 'strict',
    path: SESSION_PATH,
    maxAge: CHALLENGE_MAX_AGE_SECONDS,
  };
}

/**
 * Silme şartnamesi.
 *
 * ⚠️ `path` silmede de AYNI olmak zorunda: tarayıcı cookie'yi (ad, alan adı,
 * yol) üçlüsüyle kimliklendirir ve `/` yolundan gönderilen bir silme,
 * `/api/session` yolundaki yenileme cookie'sine DOKUNMAZ. Bu sessiz başarısızlık
 * "çıkış yaptım ama oturum duruyor" olarak ortaya çıkardı.
 */
function clearSpec(name: string, path: string): CookieSpec {
  return { name, value: '', httpOnly: true, secure: isProduction, sameSite: 'lax', path, maxAge: 0 };
}

export function clearChallenge(): CookieSpec {
  return clearSpec(COOKIE_NAMES.challenge, SESSION_PATH);
}

/** Oturuma ait HER ŞEYİ siler — çıkış ve `TOKEN_INVALID` yolunda kullanılır. */
export function clearAll(): CookieSpec[] {
  return [
    clearSpec(COOKIE_NAMES.access, '/'),
    clearSpec(COOKIE_NAMES.refresh, SESSION_PATH),
    clearSpec(COOKIE_NAMES.challenge, SESSION_PATH),
  ];
}

/** Erişim token'ı, yenilemeye bu kadar saniye kala tazelenir. */
export const REFRESH_SKEW_SECONDS = 60;

/** Mühürlü `exp`e göre: bu token yenilenmeli mi? */
export function needsRefresh(payload: Pick<AccessPayload, 'exp'>, nowMs: number): boolean {
  return payload.exp - REFRESH_SKEW_SECONDS <= Math.floor(nowMs / 1000);
}

/** Mühürlü `exp`e göre: bu token tamamen geçti mi? */
export function isExpired(payload: Pick<AccessPayload, 'exp'>, nowMs: number): boolean {
  return payload.exp <= Math.floor(nowMs / 1000);
}
