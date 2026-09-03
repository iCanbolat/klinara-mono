import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * `seal.ts` `serverEnv`i modül yüklenirken okuyor; bu yüzden ortam
 * değişkenleri DİNAMİK import'tan önce kuruluyor. (Statik import'lar hoist
 * edilir ve `process.env` ataması geç kalırdı.)
 */
const CURRENT = base64Key(1);
const PREVIOUS = base64Key(2);
const OTHER = base64Key(3);

/**
 * ⚠️ Bu dosya `process.env`i DEĞİŞTİRİYOR (anahtar rotasyonunu sınamak için) ve
 * vitest worker'ları dosyalar arasında yeniden kullanılıyor. Sızıntıyı
 * `afterAll` ile kapatıyoruz: aksi hâlde bu dosyadan sonra aynı worker'da
 * koşan bir test, boş bir oturum anahtarıyla karşılaşabilirdi.
 */
const ORIGINAL = {
  secret: process.env.ADMIN_SESSION_SECRET,
  previous: process.env.ADMIN_SESSION_SECRET_PREVIOUS,
  keyId: process.env.ADMIN_SESSION_KEY_ID,
};

let seal: typeof import('../../src/lib/session/seal').seal;
let unseal: typeof import('../../src/lib/session/seal').unseal;

beforeAll(async () => {
  process.env.ADMIN_SESSION_SECRET = CURRENT;
  process.env.ADMIN_SESSION_SECRET_PREVIOUS = PREVIOUS;
  process.env.ADMIN_SESSION_KEY_ID = 'v1';
  const sealModule = await import('../../src/lib/session/seal');
  seal = sealModule.seal;
  unseal = sealModule.unseal;
});

afterAll(() => {
  restore('ADMIN_SESSION_SECRET', ORIGINAL.secret);
  restore('ADMIN_SESSION_SECRET_PREVIOUS', ORIGINAL.previous);
  restore('ADMIN_SESSION_KEY_ID', ORIGINAL.keyId);
  vi.resetModules();
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('seal — oturum cookie mühürleme', () => {
  it('mühürlenen değer aynen geri geliyor', async () => {
    const value = { at: 'jwt.parcasi.imza', exp: 1_700_000_000, sid: 's1', tid: 't1', uid: 'u1' };
    const token = await seal(value, 'at');
    expect(await unseal(token, 'at')).toEqual(value);
  });

  it('düz metin mühürde GÖRÜNMÜYOR', () => {
    // Mührün şifreleme olduğunun, yalnız imzalama olmadığının kanıtı.
    return seal({ rt: 'cok-gizli-yenileme-tokeni' }, 'rt').then((token) => {
      expect(token).not.toContain('cok-gizli-yenileme-tokeni');
    });
  });

  it('AMAÇ farklıysa açılmıyor — yuvalar arası replay imkânsız', async () => {
    // Bu testin koruduğu şey somut: yenileme cookie'si erişim cookie'si
    // yuvasına kopyalanırsa, aynı anahtarla mühürlenmiş olmasına rağmen
    // çözülmemeli.
    const token = await seal({ rt: 'x' }, 'rt');
    expect(await unseal(token, 'at')).toBeNull();
    expect(await unseal(token, 'ch')).toBeNull();
    expect(await unseal(token, 'rt')).not.toBeNull();
  });

  it('kurcalanmış şifreli metin açılmıyor', async () => {
    const token = await seal({ a: 1 }, 'at');
    const parts = token.split('.');
    expect(await unseal(`${parts[0]}.${parts[1]}.${flipByte(parts[2] ?? '')}`, 'at')).toBeNull();
  });

  it('kurcalanmış IV açılmıyor', async () => {
    const token = await seal({ a: 1 }, 'at');
    const parts = token.split('.');
    expect(await unseal(`${parts[0]}.${flipByte(parts[1] ?? '')}.${parts[2]}`, 'at')).toBeNull();
  });

  it('kurcalanmış anahtar kimliği (AAD) açılmıyor', async () => {
    // `keyId` AAD'ye giriyor; değiştirmek kimlik doğrulamasını bozmalı.
    const token = await seal({ a: 1 }, 'at');
    const parts = token.split('.');
    expect(await unseal(`v9.${parts[1]}.${parts[2]}`, 'at')).toBeNull();
  });

  it('ÖNCEKİ anahtarla mühürlenmiş cookie açılmaya devam ediyor', async () => {
    // Rotasyonun anlamı bu: yeni anahtara geçildiğinde tüm kullanıcılar aynı
    // anda girişe düşmemeli.
    process.env.ADMIN_SESSION_SECRET = PREVIOUS;
    process.env.ADMIN_SESSION_SECRET_PREVIOUS = '';
    const { seal: sealOld } = await freshModule();
    const oldToken = await sealOld({ a: 'eski' }, 'at');

    process.env.ADMIN_SESSION_SECRET = CURRENT;
    process.env.ADMIN_SESSION_SECRET_PREVIOUS = PREVIOUS;
    const { unseal: unsealNew, seal: sealNew } = await freshModule();

    expect(await unsealNew(oldToken, 'at')).toEqual({ a: 'eski' });
    // Yeni mühürler her zaman GEÇERLİ anahtarla yazılıyor.
    const newToken = await sealNew({ a: 'yeni' }, 'at');
    expect(newToken).not.toBe(oldToken);
  });

  it('tanınmayan anahtarla mühürlenmiş cookie açılmıyor', async () => {
    process.env.ADMIN_SESSION_SECRET = OTHER;
    process.env.ADMIN_SESSION_SECRET_PREVIOUS = '';
    const { seal: sealOther } = await freshModule();
    const foreign = await sealOther({ a: 1 }, 'at');

    process.env.ADMIN_SESSION_SECRET = CURRENT;
    process.env.ADMIN_SESSION_SECRET_PREVIOUS = PREVIOUS;
    const { unseal: unsealMine } = await freshModule();
    expect(await unsealMine(foreign, 'at')).toBeNull();
  });

  it('biçimsiz girdilerin HEPSİ null dönüyor', async () => {
    for (const bad of ['', 'abc', 'a.b', 'a.b.c.d', 'v1..x', 'v1.x.', '..', 'v1.!!!.###']) {
      expect(await unseal(bad, 'at'), bad).toBeNull();
    }
  });

  it('anahtar 32 bayt değilse ANLAŞILIR hata veriyor', async () => {
    process.env.ADMIN_SESSION_SECRET = btoa('kisa');
    const { seal: sealShort } = await freshModule();
    await expect(sealShort({ a: 1 }, 'at')).rejects.toThrow(/32 bayt/);
  });

  it('anahtar tanımsızsa SESSİZCE şifresiz yazmıyor, patlıyor', async () => {
    process.env.ADMIN_SESSION_SECRET = '';
    const { seal: sealNone } = await freshModule();
    await expect(sealNone({ a: 1 }, 'at')).rejects.toThrow(/ADMIN_SESSION_SECRET/);
  });

  it('her mühür farklı IV kullanıyor — aynı değer iki kez aynı çıkmıyor', async () => {
    process.env.ADMIN_SESSION_SECRET = CURRENT;
    const { seal: s } = await freshModule();
    expect(await s({ a: 1 }, 'at')).not.toBe(await s({ a: 1 }, 'at'));
  });
});

async function freshModule(): Promise<typeof import('../../src/lib/session/seal')> {
  // `vi.resetModules()` şart: `seal.ts` ortam değişkenlerini modül yüklenirken
  // okuyor, yani anahtar değişimini ancak yeniden yükleme görür.
  vi.resetModules();
  return import('../../src/lib/session/seal');
}

/**
 * base64url dizesinin İLK BAYTINI çevirir.
 *
 * ⚠️ Son KARAKTERİ değiştirmek yetmiyor ve bu testi bir süre yanlış sebeple
 * geçirdi: base64'ün son karakteri, uzunluğa göre yalnız 2 ya da 4 anlamlı bit
 * taşır ve kalan bitler dolgudur — 'A' ile 'B' AYNI bayt dizisine çözülebilir,
 * yani şifreli metin hiç değişmez ve mühür haklı olarak açılır. Bu yüzden
 * baytlara inip gerçekten bir bayt değiştiriyoruz.
 */
function flipByte(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;

  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Deterministik 32 baytlık base64 anahtar. */
function base64Key(fill: number): string {
  let binary = '';
  for (let index = 0; index < 32; index += 1) binary += String.fromCharCode((fill * 7 + index) % 256);
  return btoa(binary);
}
