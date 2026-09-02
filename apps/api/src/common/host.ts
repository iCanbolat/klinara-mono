import { domainToASCII } from 'node:url';

/**
 * Konak adı normalizasyonu — public çözümlemenin tek giriş kapısı.
 *
 * `booking_site_domains.host` `citext` ve platform genelinde tekil. Tekilliğin
 * bir anlamı olması için kanonik BİR biçim gerekiyor: aynı alan adının
 * `Randevu.Klinik.COM.`, `randevu.klinik.com:443` ve `randevu.kliniğim.com`
 * yazımları tek satıra düşmeli. Aksi hâlde iki kiracı "farklı" iki satırla aynı
 * alan adını alabilirdi.
 *
 * IDN (`kliniğim.com`) punycode'a çevrilir: Türkiye'de bu tercih edilen bir
 * alan adı biçimi ve DNS'te zaten punycode olarak yaşıyor.
 */

const MAX_HOST_LENGTH = 253;
/** Punycode'a çevrilmiş, küçük harfli, en az bir noktası olan konak adı. */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

export function normalizeHost(raw: string): string | undefined {
  let value = raw.trim().toLowerCase();
  if (value === '') return undefined;

  // Şema veya yol içeren girdi konak adı DEĞİLDİR. Ayrıştırıp "kurtarmak"
  // yerine reddediyoruz: `https://evil.com/@klinik.com` gibi bir girdinin
  // hangi kısmının konak adı olduğu tartışmalıdır ve tartışmalı olan şey
  // güvenlik kararına temel olamaz.
  if (value.includes('/') || value.includes('\\') || value.includes('@')) return undefined;

  // Port: `randevu.klinik.com:8443`.
  const portIndex = value.lastIndexOf(':');
  if (portIndex !== -1) {
    const port = value.slice(portIndex + 1);
    if (!/^\d{1,5}$/.test(port)) return undefined;
    value = value.slice(0, portIndex);
  }

  // Kök noktası: DNS'te `example.com.` geçerlidir, bizim kanonik biçimimizde değil.
  if (value.endsWith('.')) value = value.slice(0, -1);
  if (value === '' || value.includes('..')) return undefined;

  const ascii = domainToASCII(value);
  if (ascii === '') return undefined;
  if (ascii.length > MAX_HOST_LENGTH) return undefined;
  if (!HOST_PATTERN.test(ascii)) return undefined;
  // Tek etiketli girdi (`localhost`) bir randevu sayfası adresi olamaz.
  if (!ascii.includes('.')) return undefined;

  return ascii;
}

/** `{slug}.{root}` — platform subdomain'i. */
export function platformHost(slug: string, rootDomain: string): string {
  return `${slug}.${rootDomain}`;
}

/**
 * Konak adı platformun kök alan adının altında mı.
 *
 * Özel alan adı olarak talep edilemeyecek adresler bunlar: bir kiracı
 * `api.klinara.app`i "kendi alan adım" diye kaydedebilseydi platformun
 * kendi uçlarını ele geçirebilirdi.
 */
export function isPlatformHost(host: string, rootDomain: string): boolean {
  return host === rootDomain || host.endsWith(`.${rootDomain}`);
}
