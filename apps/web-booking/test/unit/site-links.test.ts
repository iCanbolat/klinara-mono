import { describe, expect, it } from 'vitest';
import { bookingHref, homeHref, manageHref } from '@/lib/site-links';

const site = (published: boolean, canonicalUrl = 'https://klinik-x.klinara.app') => ({
  slug: 'klinik-x',
  published,
  canonicalUrl,
});

describe('site bağlantıları', () => {
  it('kiracı konak adında yollar köke göredir', () => {
    expect(bookingHref(site(true), false)).toBe('/randevu');
    expect(manageHref(site(true), 'tkn', false)).toBe('/r/tkn');
    expect(homeHref(site(true), false)).toBe('/');
  });

  it('doğrudan bağlantıda her yol `klinik` parametresini taşır', () => {
    expect(bookingHref(site(false), true)).toBe('/randevu?klinik=klinik-x');
    expect(manageHref(site(false), 'tkn', true)).toBe('/r/tkn?klinik=klinik-x');
  });

  it('sayfa yayında değilse dönülecek tanıtım sayfası yoktur', () => {
    expect(homeHref(site(false), true)).toBeNull();
    expect(homeHref(site(false), false)).toBeNull();
  });

  it('doğrudan bağlantıda tanıtım sayfası kanonik adrestir, platformun kökü değil', () => {
    expect(homeHref(site(true), true)).toBe('https://klinik-x.klinara.app');
    expect(homeHref(site(true, ''), true)).toBeNull();
  });
});
