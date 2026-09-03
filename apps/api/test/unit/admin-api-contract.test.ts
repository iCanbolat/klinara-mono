import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ASSET_LIMITS,
  ASSET_MIME_TYPES,
  ASSET_PURPOSES,
  BOOKING_SITE_STATUSES,
  DOMAIN_KINDS,
  DOMAIN_VERIFICATION_STATUSES,
  OTP_CHANNELS,
  SETTINGS_LIMITS,
  type Asset,
  type BookingPage,
  type BookingPageContent,
  type BookingSiteSettings,
  type ConfirmAssetInput,
  type CreateDomainInput,
  type DnsInstructions,
  type Domain,
  type PresignAssetInput,
  type PresignAssetResponse,
  type RevisionSummary,
  type UpdateBookingPageInput,
} from '@klinara/shared';
import {
  BookingPageDto,
  BookingSiteSettingsDto,
  BOOKING_SITE_STATUSES as DTO_SITE_STATUSES,
  UpdateBookingPageDto,
} from '../../src/modules/booking-page/dto/booking-page.dto';
import {
  BookingPageContentDto,
  RevisionSummaryDto,
} from '../../src/modules/booking-page/dto/content.dto';
import {
  AssetDto,
  ASSET_MIME_TYPES as DTO_ASSET_MIME_TYPES,
  ASSET_PURPOSES as DTO_ASSET_PURPOSES,
  ConfirmAssetDto,
  PresignAssetDto,
  PresignAssetResponseDto,
} from '../../src/modules/booking-page/dto/asset.dto';
import { CreateDomainDto, DnsInstructionsDto, DomainDto } from '../../src/modules/booking-page/dto/domain.dto';
import { EnvironmentVariables } from '../../src/config/env.validation';

/**
 * Yönetim API'si iki yerde temsil ediliyor: `apps/api/.../dto/*` sınıfları
 * (sunucu doğrulaması + Swagger) ve `@klinara/shared`'teki `admin-api.ts`
 * tipleri (`apps/web-admin`'in gördüğü sözleşme).
 *
 * `content-dictionary.test.ts` bunu blok sözlüğü için yapıyor; bu dosya aynı
 * işi yönetim yüzeyinin geri kalanı için yapar. Ayrışmanın bedeli somut:
 * sunucuya eklenen bir ayar alanı editörde görünmez, ya da editörün gönderdiği
 * bir alan `whitelist: true` ile sessizce elenir — ikisi de ancak kullanıcının
 * önünde, "kaydettim ama olmadı" olarak ortaya çıkar.
 *
 * İki yarım var: DERLEME ZAMANI atanabilirlik iddiaları (aşağıdaki tipli
 * sabitler — bir DTO alanı shared'a yazılmazsa `pnpm typecheck` kırılır) ve
 * ÇALIŞMA ZAMANI doğrulama koşumu (shared'ın ilan ettiği şeklin gerçek
 * `ValidationPipe` boru hattından geçtiğinin kanıtı).
 */

// ---------------------------------------------------------------------------
// Derleme zamanı: her DTO ↔ shared tipi çift yönlü atanabilir olmalı
// ---------------------------------------------------------------------------

/**
 * Anahtar kümesi EŞİTLİĞİ — iki yönlü.
 *
 * Düz atanabilirlik (`const x: Shared = new Dto()`) yalnız bir yönü yakalar:
 * DTO'ya eklenen fazladan bir alan üst küme ürettiği için sessizce geçer, yani
 * "sunucuya alan eklendi, shared'a yazılmadı" — tam olarak korkulan durum —
 * fark edilmezdi. Bu yüzden anahtarlar iki yönlü karşılaştırılıyor: taraflardan
 * biri diğerinde olmayan bir alan taşırsa `pnpm typecheck` kırılır.
 */
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : { eksik: Exclude<keyof B, keyof A> }
  : { fazla: Exclude<keyof A, keyof B> };

const _keysBookingPage: SameKeys<BookingPageDto, BookingPage> = true;
const _keysSettings: SameKeys<BookingSiteSettingsDto, BookingSiteSettings> = true;
const _keysUpdatePage: SameKeys<UpdateBookingPageDto, UpdateBookingPageInput> = true;
const _keysRevision: SameKeys<RevisionSummaryDto, RevisionSummary> = true;
const _keysContent: SameKeys<BookingPageContentDto, BookingPageContent> = true;
const _keysAsset: SameKeys<AssetDto, Asset> = true;
const _keysPresign: SameKeys<PresignAssetDto, PresignAssetInput> = true;
const _keysPresignResponse: SameKeys<PresignAssetResponseDto, PresignAssetResponse> = true;
const _keysConfirm: SameKeys<ConfirmAssetDto, ConfirmAssetInput> = true;
const _keysDomain: SameKeys<DomainDto, Domain> = true;
const _keysDns: SameKeys<DnsInstructionsDto, DnsInstructions> = true;
const _keysCreateDomain: SameKeys<CreateDomainDto, CreateDomainInput> = true;

/** Değer düzeyinde atanabilirlik — alan TİPLERİ de uyuşmalı, yalnız adlar değil. */
const _bookingPageToShared: BookingPage = new BookingPageDto() as BookingPageDto & {
  status: BookingPage['status'];
  settings: BookingPage['settings'];
};
const _revisionToShared: RevisionSummary = new RevisionSummaryDto();
const _assetToShared: Asset = new AssetDto() as AssetDto & { status: Asset['status'] };
const _presignResponseToShared: PresignAssetResponse = new PresignAssetResponseDto();
const _domainToShared: Domain = new DomainDto();
const _dnsToShared: DnsInstructions = new DnsInstructionsDto();

/** shared tipi → DTO sınıfı. İstemcinin gönderdiği şekli sunucu kabul etmeli. */
const _updatePageToDto: UpdateBookingPageDto = {} satisfies UpdateBookingPageInput;
const _presignToDto: PresignAssetDto = {
  purpose: 'booking_hero',
  contentType: 'image/webp',
  sizeBytes: 1024,
} satisfies PresignAssetInput;
const _confirmToDto: ConfirmAssetDto = {
  storageKey: 'public/t/a-0011aabb.webp',
  purpose: 'booking_hero',
} satisfies ConfirmAssetInput;
const _createDomainToDto: CreateDomainDto = {
  host: 'randevu.klinikx.com',
} satisfies CreateDomainInput;

void [
  _keysBookingPage,
  _keysSettings,
  _keysUpdatePage,
  _keysRevision,
  _keysContent,
  _keysAsset,
  _keysPresign,
  _keysPresignResponse,
  _keysConfirm,
  _keysDomain,
  _keysDns,
  _keysCreateDomain,
  _bookingPageToShared,
  _revisionToShared,
  _assetToShared,
  _presignResponseToShared,
  _domainToShared,
  _dnsToShared,
  _updatePageToDto,
  _presignToDto,
  _confirmToDto,
  _createDomainToDto,
];

// ---------------------------------------------------------------------------

describe('yönetim API sözleşmesi — shared ile DTO arasında sapma yok', () => {
  it('numaralandırmalar iki tarafta AYNI', () => {
    expect([...BOOKING_SITE_STATUSES]).toEqual([...DTO_SITE_STATUSES]);
    expect([...ASSET_PURPOSES]).toEqual([...DTO_ASSET_PURPOSES]);
    expect([...ASSET_MIME_TYPES]).toEqual([...DTO_ASSET_MIME_TYPES]);
    // Bu ikisinin DTO karşılığı `@ApiProperty({enum})` içinde satır içi yazılı;
    // sözleşme testi olmasa sessizce ayrışırlar.
    expect([...OTP_CHANNELS]).toEqual(['whatsapp', 'sms']);
    expect([...DOMAIN_KINDS]).toEqual(['platform_subdomain', 'custom']);
    expect([...DOMAIN_VERIFICATION_STATUSES]).toEqual([
      'pending',
      'dns_verified',
      'active',
      'failed',
      'disabled',
    ]);
  });

  it('varlık sınırları sunucunun REDDEDECEĞİ bir yüklemeyi teklif etmiyor', () => {
    // İstemci 5 MiB'a kadar dosya seçtirip sunucudan 400 almamalı: sınır tek
    // kaynaktan gelmeli. `BOOKING_ASSET_MAX_BYTES` varsayılanı burayla eşit.
    // `plainToInstance` boş nesneyle alan başlatıcılarını EZİYOR; varsayılanı
    // okumanın doğru yolu sınıfı doğrudan kurmak.
    expect(ASSET_LIMITS.maxBytes).toBe(new EnvironmentVariables().BOOKING_ASSET_MAX_BYTES);
    expect(ASSET_LIMITS.mimeTypes).not.toContain('image/svg+xml');
  });

  it('ayar sınırları DTO doğrulamasıyla aynı sınırda kırılıyor', () => {
    // Üst sınırın BİR fazlası reddedilmeli, tam sınır kabul edilmeli — sınırın
    // kendisinin doğru sayı olduğunu kanıtlayan tek test bu.
    for (const [field, key] of [
      ['minLeadMinutesOverride', 'minLeadMinutes'],
      ['maxAdvanceDaysOverride', 'maxAdvanceDays'],
      ['cancelWindowHoursOverride', 'cancelWindowHours'],
      ['holdTtlMinutes', 'holdTtlMinutes'],
    ] as const) {
      const limit = SETTINGS_LIMITS[key];
      expect(validateSync(plainToInstance(UpdateBookingPageDto, { [field]: limit.max })), field).toHaveLength(0);
      expect(
        validateSync(plainToInstance(UpdateBookingPageDto, { [field]: limit.max + 1 })).length,
        field,
      ).toBeGreaterThan(0);
      expect(
        validateSync(plainToInstance(UpdateBookingPageDto, { [field]: limit.min - 1 })).length,
        field,
      ).toBeGreaterThan(0);
    }
  });

  it('shared şeklinde kurulan gövdeler GERÇEK doğrulama boru hattını geçiyor', () => {
    const settings: UpdateBookingPageInput = {
      // `null` = kiracı varsayılanına düş. Editörün "varsayılanı kullan" kutusu
      // bunu gönderiyor; DTO'nun kabul ettiğini burada kanıtlıyoruz.
      minLeadMinutesOverride: null,
      holdTtlMinutes: 15,
      showPrices: false,
      otpChannel: 'sms',
      consentTexts: [{ kind: 'kvkk_explicit', text: 'Metin', required: true }],
      contactEmail: 'iletisim@klinikx.com',
    };
    expect(validateSync(plainToInstance(UpdateBookingPageDto, settings))).toHaveLength(0);

    const presign: PresignAssetInput = {
      purpose: 'booking_gallery',
      contentType: 'image/avif',
      sizeBytes: ASSET_LIMITS.maxBytes,
    };
    expect(validateSync(plainToInstance(PresignAssetDto, presign))).toHaveLength(0);

    const confirm: ConfirmAssetInput = {
      storageKey: 'public/tenant/asset-0011aabb.avif',
      purpose: 'booking_gallery',
      altText: 'Klinik girişi',
      width: 1600,
      height: 900,
      sha256: 'a'.repeat(64),
    };
    expect(validateSync(plainToInstance(ConfirmAssetDto, confirm))).toHaveLength(0);

    const domain: CreateDomainInput = { host: 'randevu.klinikx.com', makePrimary: true };
    expect(validateSync(plainToInstance(CreateDomainDto, domain))).toHaveLength(0);
  });

  it('SVG ve sözlük dışı amaç REDDEDİLİYOR', () => {
    expect(
      validateSync(
        plainToInstance(PresignAssetDto, {
          purpose: 'booking_hero',
          contentType: 'image/svg+xml',
          sizeBytes: 10,
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(
        plainToInstance(PresignAssetDto, {
          purpose: 'kurumsal_kimlik',
          contentType: 'image/png',
          sizeBytes: 10,
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
});
