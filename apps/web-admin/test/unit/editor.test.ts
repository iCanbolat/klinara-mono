import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, CONTENT_LIMITS, type ContentBlockInput } from '@klinara/shared';
import { canMove, moveBlock, removeBlock, replaceBlock } from '../../src/lib/editor/move-block';
import { BLOCK_FIELDS, BLOCK_LABEL_KEY, emptyBlock } from '../../src/lib/editor/block-schema';
import { validateSections, validateSeo } from '../../src/lib/editor/validate';
import { checkAsset, MAX_MEGABYTES } from '../../src/lib/editor/asset-rules';
import { parseDraft, shouldRestore } from '../../src/lib/editor/draft-recovery';

const hero = (title: string): ContentBlockInput => ({ type: 'hero', title });

describe('blok sıralama', () => {
  it('blok yukarı ve aşağı taşınıyor', () => {
    const sections = [hero('A'), hero('B'), hero('C')];
    expect(moveBlock(sections, 2, 0).map((b) => (b as { title: string }).title)).toEqual(['C', 'A', 'B']);
    expect(moveBlock(sections, 0, 1).map((b) => (b as { title: string }).title)).toEqual(['B', 'A', 'C']);
  });

  it('sınır dışı hedef KIRPILIYOR, hata değil', () => {
    // En üstteki bloğun "yukarı" düğmesi bir hata değil, bir şey yapmayan eylem.
    const sections = [hero('A'), hero('B')];
    expect(moveBlock(sections, 0, -1).map((b) => (b as { title: string }).title)).toEqual(['A', 'B']);
    expect(moveBlock(sections, 1, 99).map((b) => (b as { title: string }).title)).toEqual(['A', 'B']);
  });

  it('geçersiz kaynak indeksi diziyi BOZMUYOR', () => {
    const sections = [hero('A')];
    expect(moveBlock(sections, 5, 0)).toHaveLength(1);
    expect(moveBlock(sections, -1, 0)).toHaveLength(1);
  });

  it('girdi dizisi DEĞİŞTİRİLMİYOR', () => {
    const sections = [hero('A'), hero('B')];
    moveBlock(sections, 0, 1);
    expect((sections[0] as { title: string }).title).toBe('A');
  });

  it('silme ve değiştirme', () => {
    const sections = [hero('A'), hero('B'), hero('C')];
    expect(removeBlock(sections, 1).map((b) => (b as { title: string }).title)).toEqual(['A', 'C']);
    expect(
      replaceBlock(sections, 1, hero('Y')).map((b) => (b as { title: string }).title),
    ).toEqual(['A', 'Y', 'C']);
  });

  it('canMove düğme durumunu doğru veriyor', () => {
    expect(canMove(3, 0, -1)).toBe(false);
    expect(canMove(3, 0, 1)).toBe(true);
    expect(canMove(3, 2, 1)).toBe(false);
    expect(canMove(3, 2, -1)).toBe(true);
  });
});

describe('blok şeması — sözlükle sapma yok', () => {
  it('sözlükteki HER blok türünün form şartnamesi ve etiketi var', () => {
    // Sözlüğe blok eklenip forma eklenmezse editör onu düzenleyemez hâle gelir.
    for (const type of BLOCK_TYPES) {
      expect(BLOCK_FIELDS[type], type).toBeDefined();
      expect(BLOCK_LABEL_KEY[type], type).toBeDefined();
    }
    expect(Object.keys(BLOCK_FIELDS).sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it('form sınırları CONTENT_LIMITS ile AYNI', () => {
    // Sınırı forma elle kopyalamak, kullanıcının 8000 karakter yazıp
    // "Kaydet"ten SONRA hata görmesi demekti.
    const heroFields = new Map(BLOCK_FIELDS.hero.map((f) => [f.key, f]));
    expect(heroFields.get('title')?.max).toBe(CONTENT_LIMITS.hero.title);
    expect(heroFields.get('subtitle')?.max).toBe(CONTENT_LIMITS.hero.subtitle);
    expect(heroFields.get('ctaLabel')?.max).toBe(CONTENT_LIMITS.hero.ctaLabel);

    const richFields = new Map(BLOCK_FIELDS.richText.map((f) => [f.key, f]));
    expect(richFields.get('body')?.max).toBe(CONTENT_LIMITS.richText.body);

    const carouselFields = new Map(BLOCK_FIELDS.carousel.map((f) => [f.key, f]));
    expect(carouselFields.get('items')?.maxItems).toBe(CONTENT_LIMITS.carousel.items);

    const mapFields = new Map(BLOCK_FIELDS.map.map((f) => [f.key, f]));
    expect(mapFields.get('zoom')?.min).toBe(CONTENT_LIMITS.map.zoom.min);
    expect(mapFields.get('zoom')?.max).toBe(CONTENT_LIMITS.map.zoom.max);
  });

  it('yeni blok iskeleti sunucunun ZORUNLU alanlarını taşıyor', () => {
    // Boş bir blok bile geçerli bir şekle sahip olmalı; aksi hâlde kullanıcı
    // blok ekler eklemez doğrulama hatası görürdü.
    for (const type of BLOCK_TYPES) {
      const block = emptyBlock(type);
      expect(block.type, type).toBe(type);
    }
    expect(emptyBlock('hero')).toHaveProperty('title');
    expect(emptyBlock('richText')).toHaveProperty('body');
    expect(emptyBlock('carousel')).toHaveProperty('items', []);
    expect(emptyBlock('map')).toHaveProperty('zoom', CONTENT_LIMITS.map.zoom.default);
  });
});

describe('doğrulama', () => {
  it('zorunlu alan boşsa hata — RFC 9457 şekliyle', () => {
    // Şekil sunucunun `errors[]` dizisiyle aynı: arayüz tek kod yolundan basıyor.
    const errors = validateSections([hero('')]);
    expect(errors).toEqual([{ path: 'sections[0].title', message: 'Bu alan zorunlu.' }]);
  });

  it('uzunluk sınırı aşılınca hata', () => {
    const errors = validateSections([hero('x'.repeat(CONTENT_LIMITS.hero.title + 1))]);
    expect(errors[0]?.path).toBe('sections[0].title');
  });

  it('tam sınırda hata YOK', () => {
    expect(validateSections([hero('x'.repeat(CONTENT_LIMITS.hero.title))])).toHaveLength(0);
  });

  it('blok sayısı sınırı', () => {
    const many = Array.from({ length: CONTENT_LIMITS.sections.max + 1 }, () => hero('A'));
    expect(validateSections(many).some((e) => e.path === 'sections')).toBe(true);
  });

  it('harita yakınlaştırması aralık dışında olamaz', () => {
    expect(validateSections([{ type: 'map', zoom: 0 }])).toHaveLength(1);
    expect(validateSections([{ type: 'map', zoom: 21 }])).toHaveLength(1);
    expect(validateSections([{ type: 'map', zoom: 15 }])).toHaveLength(0);
  });

  it('SEO sınırları', () => {
    expect(validateSeo({ title: 'x'.repeat(CONTENT_LIMITS.seo.title + 1) })).toHaveLength(1);
    expect(validateSeo({ description: 'x'.repeat(CONTENT_LIMITS.seo.description + 1) })).toHaveLength(1);
    expect(validateSeo({ title: 'Klinik', description: 'Online randevu' })).toHaveLength(0);
  });
});

describe('varlık ön denetimi', () => {
  it('SVG kendi mesajıyla reddediliyor', () => {
    // Sunucunun reddi doğru ama kullanıcı sebebini bilmez.
    expect(checkAsset({ type: 'image/svg+xml', size: 100 })).toBe('svg');
  });

  it('desteklenmeyen tür ve büyük dosya reddediliyor', () => {
    expect(checkAsset({ type: 'application/pdf', size: 100 })).toBe('wrong-type');
    expect(checkAsset({ type: 'image/png', size: MAX_MEGABYTES * 1024 * 1024 + 1 })).toBe('too-large');
  });

  it('geçerli görsel kabul ediliyor', () => {
    expect(checkAsset({ type: 'image/webp', size: 1024 })).toBeNull();
    expect(checkAsset({ type: 'image/avif', size: MAX_MEGABYTES * 1024 * 1024 })).toBeNull();
  });
});

describe('taslak kurtarma', () => {
  it('hash FARKLIYSA geri yükleme öneriliyor', () => {
    const stored = { document: { sections: [] }, baseContentHash: 'abc', savedAt: 1 };
    expect(shouldRestore(stored, 'xyz')).toBe(true);
  });

  it('hash AYNIYSA öneri YOK — kayıp yok demektir', () => {
    // Eşitlik, sunucudaki taslağın kullanıcının bıraktığı yerle aynı olması;
    // şerit göstermek olmayan bir kayıp konusunda endişelendirirdi.
    const stored = { document: { sections: [] }, baseContentHash: 'abc', savedAt: 1 };
    expect(shouldRestore(stored, 'abc')).toBe(false);
  });

  it('saklanan taslak yoksa öneri yok', () => {
    expect(shouldRestore(null, 'abc')).toBe(false);
  });

  it('bozuk kayıt editörü ÇÖKERTMİYOR', () => {
    // `sessionStorage` kullanıcının düzenleyebildiği bir yer.
    expect(parseDraft('bu json değil')).toBeNull();
    expect(parseDraft('null')).toBeNull();
    expect(parseDraft('{"document":{}}')).toBeNull();
    expect(parseDraft('{"document":{"sections":[]}}')).toBeNull();
    expect(parseDraft('{"document":{"sections":[]},"savedAt":"dün"}')).toBeNull();
  });

  it('geçerli kayıt çözülüyor', () => {
    const parsed = parseDraft('{"document":{"sections":[]},"savedAt":123,"baseContentHash":"h"}');
    expect(parsed?.savedAt).toBe(123);
    expect(parsed?.baseContentHash).toBe('h');
  });
});
