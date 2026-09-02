import { Resolver } from 'node:dns/promises';

/** Doğrulama TXT kaydının adı: `_klinara-verify.<host>`. */
export const VERIFY_TXT_PREFIX = '_klinara-verify';

export interface DnsCheckResult {
  verified: boolean;
  /** Neden doğrulanamadı — kliniğe gösterilecek teşhis metni. */
  reason?: string;
}

export interface DnsLookup {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
}

/**
 * Alan adı sahipliğinin iki kabul edilebilir kanıtı.
 *
 * TXT (`_klinara-verify.<host>` = token) VEYA CNAME (`<host>` → hedefimiz).
 * İkisi de kabul ediliyor çünkü:
 *   * CNAME trafiğin bize ulaşması için ZATEN gerekli — ikinci bir kayıt
 *     istemek gereksiz sürtünme olurdu.
 *   * TXT ise trafiği kesmeden ÖN doğrulama sağlıyor: klinik alan adını
 *     bize bağlamadan önce her şeyin hazır olduğunu görebiliyor.
 *
 * Bu kontrol sahipliğin TEK kanıtı değildir; `dns_verified → active` terfisi
 * kenar proxy'sinin gerçek sertifika isteğinde olur (bkz. `PublicSiteResolverService`).
 * Buradaki sorgu kendi ağımızdan yapılıyor ve tek başına "trafik bize
 * ulaşıyor" demek değil.
 */
export async function checkDomainOwnership(
  lookup: DnsLookup,
  input: { host: string; token: string; dnsTarget: string },
): Promise<DnsCheckResult> {
  const txt = await safeTxt(lookup, `${VERIFY_TXT_PREFIX}.${input.host}`);
  // Uzun TXT değerleri 255 baytlık parçalara bölünür; kayıt başına parçalar
  // birleştirilerek karşılaştırılmalı.
  if (txt.some((record) => record.join('').trim() === input.token)) {
    return { verified: true };
  }

  const cname = await safeCname(lookup, input.host);
  const target = normalizeDnsName(input.dnsTarget);
  if (cname.some((value) => normalizeDnsName(value) === target)) {
    return { verified: true };
  }

  return {
    verified: false,
    reason:
      txt.length === 0 && cname.length === 0
        ? `Ne ${VERIFY_TXT_PREFIX}.${input.host} TXT kaydı ne de ${input.host} CNAME kaydı bulunabildi.`
        : `DNS kayıtları bulundu ama beklenen değerle eşleşmedi (CNAME hedefi ${input.dnsTarget} olmalı).`,
  };
}

/** DNS adlarında sondaki nokta ve büyük/küçük harf anlamsızdır. */
function normalizeDnsName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * `NXDOMAIN` bir HATA değil, bir CEVAPTIR: "kayıt yok".
 *
 * Fırlatmasına izin verseydik, henüz DNS'i kurmamış her klinik doğrulama
 * worker'ında bir istisna üretirdi ve gerçek arızalar (çözümleyici erişilemez)
 * gürültünün içinde kaybolurdu.
 */
async function safeTxt(lookup: DnsLookup, name: string): Promise<string[][]> {
  try {
    return await lookup.resolveTxt(name);
  } catch {
    return [];
  }
}

async function safeCname(lookup: DnsLookup, name: string): Promise<string[]> {
  try {
    return await lookup.resolveCname(name);
  } catch {
    return [];
  }
}

/** Üretimdeki çözümleyici; testler kendi `DnsLookup`unu geçer. */
export function systemResolver(timeoutMs = 5_000): DnsLookup {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 2 });
  return {
    resolveTxt: (name) => resolver.resolveTxt(name),
    resolveCname: (name) => resolver.resolveCname(name),
  };
}
