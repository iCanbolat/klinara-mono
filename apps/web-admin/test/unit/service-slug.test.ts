import { describe, expect, it } from 'vitest';
import { serviceSlug } from '../../src/lib/catalog/service-slug';

describe('serviceSlug', () => {
  const none = new Set<string>();

  it('Türkçe karakterleri sadeleştirir', () => {
    expect(serviceSlug('Diş Beyazlatma', none)).toBe('dis-beyazlatma');
    expect(serviceSlug('IŞIK Çözümü – İğne', none)).toBe('isik-cozumu-igne');
    expect(serviceSlug('Ortodonti Muayenesi', none)).toBe('ortodonti-muayenesi');
  });

  it('çakışmada sayı ekler', () => {
    expect(serviceSlug('Lazer', new Set(['lazer']))).toBe('lazer-2');
    expect(serviceSlug('Lazer', new Set(['lazer', 'lazer-2']))).toBe('lazer-3');
  });

  it('çok kısa ya da harfsiz adı sunucu sınırına uyduruyor', () => {
    expect(serviceSlug('PRP', none)).toBe('prp');
    expect(serviceSlug('X', none)).toBe('x-hizmet');
    expect(serviceSlug('***', none)).toBe('hizmet');
  });

  it('50 karakteri aşmaz', () => {
    const long = serviceSlug('a'.repeat(80), new Set(['a'.repeat(50)]));
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith('-2')).toBe(true);
  });
});
