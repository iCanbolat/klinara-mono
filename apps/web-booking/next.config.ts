import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * Repo'nun TEK `.env` dosyası kökte duruyor (API de oradan okuyor). Next
 * varsayılan olarak yalnız kendi klasöründeki `.env*` dosyalarına bakar; bu
 * satır olmadan `next dev` ile `pnpm dev:api` iki farklı yapılandırmayla
 * koşardı ve fark ancak "neden görseller gelmiyor" diye aranırken görünürdü.
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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Repo'nun TEK lint yapılandırması kökteki `eslint.config.js`. Next'in kendi
  // gömülü lint koşusu farklı kural setiyle çalışıp bizim `eslint-disable`
  // yorumlarımızı "gereksiz" diye işaretliyordu — iki lint konfigürasyonunun
  // birbiriyle tartışması, gerçek uyarıları gürültüye gömer.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  // NOT: `output: 'standalone'` BİLEREK yok. `next start` ile çalışmıyor
  // (Next'in kendisi uyarıyor) ve dağıtım biçimi Faz 10.4'ün kararı — onu
  // şimdiden seçmek, yerel doğrulamayı bozan bir varsayım olurdu.
  images: {
    remotePatterns: assetPattern(),
  },
  typedRoutes: true,
};

export default nextConfig;
