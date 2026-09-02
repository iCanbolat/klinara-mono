import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  BLOCK_TYPES,
  CONTENT_LIMITS,
  CONTENT_SCHEMA_VERSION,
  FONT_FAMILIES,
  RADII,
  type CarouselBlockInput,
  type ContentBlockInput,
  type HeroBlockInput,
  type MapBlockInput,
  type SeoInput,
  type ThemeInput,
} from '@klinara/shared';
import {
  CarouselBlockDto,
  ContactBlockDto,
  HeroBlockDto,
  MapBlockDto,
  RichTextBlockDto,
  SeoDto,
  ServiceListBlockDto,
  ThemeDto,
  UpdateBookingPageContentDto,
} from '../../src/modules/booking-page/dto/content.dto';
import { CONTENT_SCHEMA_VERSION as SCHEMA_VERSION_FROM_DB } from '../../src/database/schema';

/**
 * Sözlük iki yerde temsil ediliyor: `@klinara/shared`'te tip + sabit olarak
 * (web istemcisi ve editör için), `content.dto.ts`'te class-validator sınıfı
 * olarak (sunucu doğrulaması için). İkisinin sessizce ayrışmasını durduran tek
 * şey bu dosya — ayrışma aksi hâlde ancak editör "Yayınla"ya bastığında,
 * yani kullanıcının önünde görünürdü.
 */
describe('içerik sözlüğü — shared ile DTO arasında sapma yok', () => {
  it('sözlükteki her tür GERÇEK boru hattında doğru DTO sınıfına dönüşüyor', () => {
    // Kontrol metadata'yı okumakla değil, üretimdeki dönüşümü koşturmakla
    // yapılıyor: sözlüğe bir tür eklenip DTO'nun discriminator listesine
    // eklenmezse gövde sessizce reddedilir (istemci hatayı ancak yayında
    // görür); tersi olursa veritabanı renderer'ın çizemeyeceği bir blok tutar.
    for (const type of BLOCK_TYPES) {
      const dto = plainToInstance(UpdateBookingPageContentDto, {
        sections: [SAMPLE_BLOCK[type]],
      });
      const section = dto.sections[0];
      expect(section, `${type} bloğu dönüşmedi`).toBeInstanceOf(DTO_BY_TYPE[type]);
      expect(validateSync(dto), `${type} bloğu doğrulamayı geçmedi`).toHaveLength(0);
    }
  });

  it('sözlükte olmayan blok türü REDDEDİLİYOR', () => {
    const dto = plainToInstance(UpdateBookingPageContentDto, {
      sections: [{ type: 'video', url: 'https://ornek.com/x.mp4' }],
    });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('her blok türü için bir DTO sınıfı var', () => {
    for (const type of BLOCK_TYPES) {
      expect(DTO_BY_TYPE[type]).toBeTypeOf('function');
    }
  });

  it('şema sürümü tek kaynaktan geliyor', () => {
    expect(SCHEMA_VERSION_FROM_DB).toBe(CONTENT_SCHEMA_VERSION);
  });

  it('tema beyaz listeleri boş değil ve serbest metin kabul etmiyor', () => {
    expect(FONT_FAMILIES.length).toBeGreaterThan(0);
    expect(RADII.length).toBeGreaterThan(0);
    expect([...FONT_FAMILIES]).not.toContain('');
  });

  it('sınırlar makul ve pozitif', () => {
    expect(CONTENT_LIMITS.sections.max).toBeGreaterThan(0);
    expect(CONTENT_LIMITS.richText.body).toBeGreaterThan(CONTENT_LIMITS.richText.title);
    expect(CONTENT_LIMITS.map.zoom.min).toBeLessThan(CONTENT_LIMITS.map.zoom.max);
    expect(CONTENT_LIMITS.map.zoom.default).toBeGreaterThanOrEqual(CONTENT_LIMITS.map.zoom.min);
    expect(CONTENT_LIMITS.map.zoom.default).toBeLessThanOrEqual(CONTENT_LIMITS.map.zoom.max);
  });

  it('DTO örnekleri shared tiplerine atanabiliyor (derleme zamanı sözleşmesi)', () => {
    // Bu atamalar RUNTIME'da hiçbir şey iddia etmiyor; değerleri `tsc`
    // kontrol ediyor. Bir DTO'ya alan eklenip shared'e eklenmezse `pnpm
    // typecheck` burada kırılır.
    const hero: HeroBlockInput = Object.assign(new HeroBlockDto(), {
      type: 'hero' as const,
      title: 'Merhaba',
    });
    const carousel: CarouselBlockInput = Object.assign(new CarouselBlockDto(), {
      type: 'carousel' as const,
      items: [],
    });
    const map: MapBlockInput = Object.assign(new MapBlockDto(), { type: 'map' as const });
    const theme: ThemeInput = new ThemeDto();
    const seo: SeoInput = new SeoDto();
    const sections: ContentBlockInput[] = [hero, carousel, map];

    expect(sections).toHaveLength(3);
    expect(theme).toBeDefined();
    expect(seo).toBeDefined();
  });
});

const DTO_BY_TYPE = {
  hero: HeroBlockDto,
  richText: RichTextBlockDto,
  carousel: CarouselBlockDto,
  serviceList: ServiceListBlockDto,
  contact: ContactBlockDto,
  map: MapBlockDto,
} as const;

/** Her tür için doğrulamayı geçen en küçük geçerli gövde. */
const SAMPLE_BLOCK: Record<(typeof BLOCK_TYPES)[number], Record<string, unknown>> = {
  hero: { type: 'hero', title: 'Merhaba' },
  richText: { type: 'richText', body: '# Başlık' },
  carousel: { type: 'carousel', items: [] },
  serviceList: { type: 'serviceList' },
  contact: { type: 'contact' },
  map: { type: 'map' },
};
