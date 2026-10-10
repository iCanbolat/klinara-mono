import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const ROOT = 'klinara.localhost';

function request(host: string, path: string): NextRequest {
  return new NextRequest(`http://${host}${path}`, { headers: { host } });
}

function stubResolve(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const rewrite = (response: Response) => response.headers.get('x-middleware-rewrite');

describe('middleware: doğrudan randevu bağlantısı', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('kök konak adında `/randevu?klinik=` kiracıyı PARAMETREDEN seçer, API’ye sormaz', async () => {
    const fetchMock = stubResolve({});
    const response = await middleware(request(ROOT, '/randevu?klinik=klinik-x'));

    expect(rewrite(response)).toBe(`http://${ROOT}/klinik-x/direkt?klinik=klinik-x`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('self-servis bağlantısı da parametreyle çözülür', async () => {
    stubResolve({});
    const response = await middleware(request(ROOT, '/r/tkn123?klinik=klinik-x'));
    expect(rewrite(response)).toBe(`http://${ROOT}/klinik-x/direkt/r/tkn123?klinik=klinik-x`);
  });

  it.each(['/randevu', '/randevu?klinik=Geçersiz!', '/?klinik=klinik-x', '/baska?klinik=klinik-x'])(
    'kök konak adında %s bilinmeyen konak ekranına düşer',
    async (path) => {
      stubResolve({});
      const response = await middleware(request(ROOT, path));
      expect(rewrite(response)).toBe(`http://${ROOT}/unknown.host`);
    },
  );

  it('sayfası yayında olmayan subdomain doğrudan bağlantıya yönlendirilir', async () => {
    const directUrl = `https://${ROOT}/randevu?klinik=taslak`;
    stubResolve({ slug: 'taslak', canonicalUrl: directUrl, directUrl });

    const home = await middleware(request(`taslak.${ROOT}`, '/'));
    expect(home.status).toBe(307);
    expect(home.headers.get('location')).toBe(directUrl);

    const manage = await middleware(request(`taslak.${ROOT}`, '/r/tkn123'));
    expect(manage.headers.get('location')).toBe(`https://${ROOT}/r/tkn123?klinik=taslak`);
  });

  it('yayındaki subdomain eskisi gibi slug’a yazılır', async () => {
    stubResolve({ slug: 'yayinda', canonicalUrl: `https://yayinda.${ROOT}`, directUrl: null });
    const response = await middleware(request(`yayinda.${ROOT}`, '/randevu'));
    expect(rewrite(response)).toBe(`http://yayinda.${ROOT}/yayinda/randevu`);
  });

  it('`/direkt` iç rotası kiracı konak adından açılamaz', async () => {
    stubResolve({ slug: 'ic-rota', canonicalUrl: `https://ic-rota.${ROOT}`, directUrl: null });
    const response = await middleware(request(`ic-rota.${ROOT}`, '/direkt'));
    expect(rewrite(response)).toBe(`http://ic-rota.${ROOT}/unknown.host`);
  });
});
