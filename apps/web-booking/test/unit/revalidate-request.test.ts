import { describe, it, expect } from 'vitest';
import { evaluateRevalidate } from '../../src/lib/revalidate-request';

const SECRET = 'yerel-revalidate-sirri-32-karakterden-uzun-olmali';

describe('purge isteği doğrulaması', () => {
  it('doğru sırla dört etiketi de düşürüyor', () => {
    const result = evaluateRevalidate({
      configuredSecret: SECRET,
      providedSecret: SECRET,
      slug: 'demo-klinik',
    });
    expect(result).toEqual({
      ok: true,
      tags: [
        'site:demo-klinik',
        'site:demo-klinik:content',
        'site:demo-klinik:catalog',
        'site:demo-klinik:staff',
      ],
    });
  });

  it('yanlış ya da eksik sır 401', () => {
    for (const provided of [null, '', 'yanlis', `${SECRET}x`]) {
      expect(
        evaluateRevalidate({ configuredSecret: SECRET, providedSecret: provided, slug: 'demo' }),
      ).toEqual({ ok: false, status: 401 });
    }
  });

  it('sır YAPILANDIRILMAMIŞSA uç kapalı (503), açık değil', () => {
    // Eksik yapılandırmanın güvenli yönü kapalı olmaktır: aksi hâlde sırrı
    // unutmuş bir kurulumda cache'i herkes düşürebilirdi.
    expect(
      evaluateRevalidate({ configuredSecret: '', providedSecret: null, slug: 'demo' }),
    ).toEqual({ ok: false, status: 503 });
  });

  it('bozuk slug 400 — tag ad alanı saldırgan kontrolüne geçmiyor', () => {
    for (const slug of [undefined, '', 42, 'Demo', 'a/b', '../x', 'site:evil']) {
      expect(
        evaluateRevalidate({ configuredSecret: SECRET, providedSecret: SECRET, slug }),
      ).toEqual({ ok: false, status: 400 });
    }
  });

  it('istenen etiketler yalnız KENDİ slug ad alanından seçilebilir', () => {
    expect(
      evaluateRevalidate({
        configuredSecret: SECRET,
        providedSecret: SECRET,
        slug: 'demo',
        tags: ['site:demo:content', 'site:baska-klinik:content'],
      }),
    ).toEqual({ ok: true, tags: ['site:demo:content'] });

    expect(
      evaluateRevalidate({
        configuredSecret: SECRET,
        providedSecret: SECRET,
        slug: 'demo',
        tags: ['site:baska-klinik:content'],
      }),
    ).toEqual({ ok: false, status: 400 });
  });
});
