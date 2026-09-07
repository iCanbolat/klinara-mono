import { describe, expect, it } from 'vitest';
import { PERMISSIONS, type CustomerNote } from '@klinara/shared';
import { canWriteNote, isStale, noteVisibility } from '../../src/lib/customers/notes';
import {
  cacheUntil,
  isAllowedType,
  isCacheValid,
  kindOf,
  shouldFallbackToOriginal,
} from '../../src/lib/customers/upload';
import { ApiProblemError, SessionExpiredError } from '../../src/lib/api/client';

const RECEPTION = [PERMISSIONS.CUSTOMER_READ, PERMISSIONS.CUSTOMER_WRITE];
const PRACTITIONER = [
  PERMISSIONS.CUSTOMER_READ,
  PERMISSIONS.CUSTOMER_MEDICAL_READ,
  PERMISSIONS.CUSTOMER_MEDICAL_WRITE,
];
const MANAGER = [...RECEPTION, PERMISSIONS.CUSTOMER_MEDICAL_READ];

describe('not görünürlüğü', () => {
  it('tıbbi izni OLMAYAN yalnız `general` görüyor', () => {
    const visibility = noteVisibility(RECEPTION);
    expect(visibility.kinds).toEqual(['general']);
    expect(visibility.medicalHidden).toBe(true);
  });

  it('tıbbi izni OLAN üç türü de görüyor', () => {
    const visibility = noteVisibility(MANAGER);
    expect(visibility.kinds).toEqual(['general', 'treatment', 'internal']);
    expect(visibility.medicalHidden).toBe(false);
  });

  it('gizlenen türler AÇIKÇA işaretleniyor', () => {
    // Sunucu tıbbi notları SESSİZCE eliyor; boş bir "Tedavi notları" sekmesi
    // resepsiyona "bu müşterinin tedavi notu yok" derdi — yanlış bilgi.
    // `medicalHidden` bayrağı arayüzün bu sessizliği kırmasını sağlıyor.
    expect(noteVisibility(RECEPTION).medicalHidden).toBe(true);
    expect(noteVisibility(MANAGER).medicalHidden).toBe(false);
  });

  it('tıbbi not YAZMA ayrı bir izin', () => {
    // `manager` tıbbi notu GÖRÜR ama YAZAMAZ; sunucu bunu SERVİSTE
    // zorluyor (rota metadata'sında görünmüyor).
    expect(noteVisibility(MANAGER).canWriteMedical).toBe(false);
    expect(noteVisibility(PRACTITIONER).canWriteMedical).toBe(true);
  });

  it('canWriteNote tür bazında karar veriyor', () => {
    expect(canWriteNote(RECEPTION, 'general')).toBe(true);
    expect(canWriteNote(RECEPTION, 'treatment')).toBe(false);

    // Uygulayıcı `customer:write` TAŞIMIYOR: tıbbi notu bile yazamaz.
    expect(canWriteNote(PRACTITIONER, 'general')).toBe(false);
    expect(canWriteNote([...PRACTITIONER, PERMISSIONS.CUSTOMER_WRITE], 'treatment')).toBe(true);
  });

  it('sürüm karşılaştırması bayat notu yakalıyor', () => {
    // `PATCH /notes/:id` `If-Match` istemiyor: son yazan kazanır. Kilit
    // koyamıyoruz ama sessiz kalmak zorunda değiliz.
    const note = { version: 5 } as CustomerNote;
    expect(isStale(3, note)).toBe(true);
    expect(isStale(5, note)).toBe(false);
    expect(isStale(7, note)).toBe(false);
  });
});

describe('dosya kararları', () => {
  it('SVG kabul edilmiyor', () => {
    // SVG çalıştırılabilir içerik taşır; sunucunun beyaz listesinde de yok.
    expect(isAllowedType('image/svg+xml')).toBe(false);
    expect(isAllowedType('image/jpeg')).toBe(true);
    expect(isAllowedType('application/pdf')).toBe(true);
    expect(isAllowedType('text/html')).toBe(false);
  });

  it('PDF `document`, görseller `photo`', () => {
    expect(kindOf('application/pdf')).toBe('document');
    expect(kindOf('image/jpeg')).toBe('photo');
    expect(kindOf('image/heic')).toBe('photo');
  });

  it('`thumb` 409 alınca `original`a DÜŞÜLÜYOR', () => {
    // Sunucu küçük görsel hazır değilken sessizce tam boyuta düşmüyor,
    // 409 veriyor. İstemcinin doğru yanıtı kırık görsel göstermek değil.
    const conflict = new ApiProblemError(
      { code: 'CONFLICT', status: 409 } as never,
      null,
    );
    expect(shouldFallbackToOriginal(conflict, 'thumb')).toBe(true);

    // `original` zaten istenmişse düşülecek bir yer yok.
    expect(shouldFallbackToOriginal(conflict, 'original')).toBe(false);
  });

  it('BAŞKA hatalarda düşülmüyor — hata gizlenmiyor', () => {
    const forbidden = new ApiProblemError({ code: 'FORBIDDEN', status: 403 } as never, null);
    expect(shouldFallbackToOriginal(forbidden, 'thumb')).toBe(false);
    expect(shouldFallbackToOriginal(new SessionExpiredError(), 'thumb')).toBe(false);
    expect(shouldFallbackToOriginal(new TypeError('network'), 'thumb')).toBe(false);
  });

  it('önbellek süresi SUNUCUNUN `expiresAt`inden türüyor', () => {
    // Sabit bir TTL sunucunun `S3_PRESIGN_TTL_SECONDS` ayarıyla ayrışırdı ve
    // süresi dolmuş bir adres kullanıcıya kırık bağlantı olarak görünürdü.
    const now = 1_000_000;
    const until = cacheUntil(new Date(now + 300_000).toISOString(), now);
    // 30 sn güvenlik payı düşülüyor.
    expect(until).toBe(now + 270_000);
  });

  it('geçersiz ya da geçmiş `expiresAt` önbelleği geçersiz kılıyor', () => {
    const now = 1_000_000;
    expect(cacheUntil('gecersiz', now)).toBe(now);
    expect(isCacheValid(cacheUntil('gecersiz', now), now)).toBe(false);
    expect(isCacheValid(cacheUntil(new Date(now - 1000).toISOString(), now), now)).toBe(false);
    expect(isCacheValid(undefined, now)).toBe(false);
    expect(isCacheValid(now + 1000, now)).toBe(true);
  });
});
