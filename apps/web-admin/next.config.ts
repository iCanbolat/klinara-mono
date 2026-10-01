import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * Repo'nun TEK `.env` dosyası kökte duruyor; Next yalnız kendi klasörüne bakar.
 * `apps/web-booking/next.config.ts` ile aynı gerekçe.
 */
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const assetBase = process.env.NEXT_PUBLIC_ASSET_BASE_URL ?? '';

/** Varlık CDN'inin `remotePatterns` karşılığı — elle yazılmaz, türetilir. */
function assetPattern(): NonNullable<NonNullable<NextConfig['images']>['remotePatterns']> {
  if (assetBase === '') return [];
  const url = new URL(assetBase);
  return [
    {
      protocol: url.protocol.replace(':', '') as 'http' | 'https',
      hostname: url.hostname,
      ...(url.port === '' ? {} : { port: url.port }),
      pathname: `${url.pathname.replace(/\/$/, '')}/**`,
    },
  ];
}

/** `src/config/env.ts`teki `apiInternalUrl` ile aynı varsayılan. */
const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:3000/api/v1').replace(
  /\/$/,
  '',
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Kökteki `eslint.config.js` tek otorite — bkz. web-booking'deki aynı yorum.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  images: { remotePatterns: assetPattern() },
  typedRoutes: true,
  /**
   * Anlık olay soketi (WebSocket). Route Handler bağlantı yükseltemediği için
   * `/api/a` proxy'sinden geçemiyor; Next'in rewrite'ı yükseltmeyi API'ye
   * aktarıyor ve tarayıcı yine YALNIZ kendi origin'ini görüyor. Yol sabit ve
   * tek: bu bir tünel değil. Kimlik cookie ile değil biletle
   * (`src/lib/realtime/realtime-client.ts`).
   *
   * ⚠️ Hedef DERLEME anında sabitlenir: `API_INTERNAL_URL` `next build`
   * sırasında da doğru olmalı.
   */
  rewrites: () =>
    Promise.resolve([{ source: '/api/realtime', destination: `${apiInternalUrl}/realtime` }]),
};

export default nextConfig;
