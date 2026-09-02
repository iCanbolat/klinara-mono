import { describe, it, expect } from 'vitest';
import { allSiteTags, isValidSlug, siteTags } from '../../src/lib/cache-tags';

describe('cache etiketleri', () => {
  it('dört etiketi de üretiyor', () => {
    expect(allSiteTags('demo')).toEqual([
      'site:demo',
      'site:demo:content',
      'site:demo:catalog',
      'site:demo:staff',
    ]);
    expect(siteTags.content('demo')).toBe('site:demo:content');
  });

  it('etiket ad alanına saldırgan kontrolündeki slug girmiyor', () => {
    for (const bad of ['', 'Demo', 'de mo', '-demo', 'demo:evil', '../x', 'a'.repeat(64)]) {
      expect(isValidSlug(bad), bad).toBe(false);
    }
    expect(isValidSlug('demo-klinik')).toBe(true);
  });
});
