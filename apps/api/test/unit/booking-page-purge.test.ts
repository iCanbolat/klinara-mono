import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { BookingPagePurgeWorker } from '../../src/modules/booking-page/booking-page-purge.worker';

const LOGGER = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };

function worker(env: Record<string, unknown>): BookingPagePurgeWorker {
  const config = new ConfigService({
    WEB_REVALIDATE_URL: '',
    WEB_REVALIDATE_SECRET: 'sir',
    WEB_REVALIDATE_TIMEOUT_MS: 5_000,
    ...env,
  });
  return new BookingPagePurgeWorker(
    { register: vi.fn() } as never,
    config as never,
    LOGGER as never,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('yayın purge worker’ı', () => {
  it('doğru URL, başlık ve gövdeyi gönderiyor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await worker({
      WEB_REVALIDATE_URL: 'https://ornek.test/api/revalidate',
      WEB_REVALIDATE_SECRET: 'cok-gizli',
    }).purge({ slug: 'demo', reason: 'publish' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ornek.test/api/revalidate');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-klinara-revalidate-secret']).toBe(
      'cok-gizli',
    );
    expect(JSON.parse(init.body as string)).toEqual({ slug: 'demo', reason: 'publish' });
  });

  it('URL boşken HİÇ istek yapmıyor ve hata fırlatmıyor', async () => {
    // API tek başına da (web istemcisi olmadan) koşabilmeli; aksi hâlde her
    // yayın bir retry fırtınası üretirdi.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(worker({}).purge({ slug: 'demo', reason: 'publish' })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('2xx olmayan yanıtta FIRLATIYOR — pg-boss yeniden denesin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(
      worker({ WEB_REVALIDATE_URL: 'https://ornek.test/r' }).purge({
        slug: 'demo',
        reason: 'publish',
      }),
    ).rejects.toThrow(/500/);
  });

  it('ağ hatası ve zaman aşımı da fırlatıyor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(
      worker({ WEB_REVALIDATE_URL: 'https://ornek.test/r' }).purge({
        slug: 'demo',
        reason: 'publish',
      }),
    ).rejects.toThrow('timeout');
  });
});
