import closeWithGrace from 'close-with-grace';
import { EnvValidationError, getEnv, type Env } from './config/env.js';
import { initTelemetry, shutdownTelemetry } from './telemetry.js';

// Env'i telemetriden önce doğrula, telemetriyi `app.js`ten ÖNCE başlat:
// OpenTelemetry enstrümante edeceği modülleri yüklenirken yamalar.
let env: Env;
try {
  env = getEnv();
} catch (error) {
  if (error instanceof EnvValidationError) {
    process.stderr.write(`\n[klinara-api] AÇILIŞ BAŞARISIZ\n${error.message}\n\n`);
    process.exit(1);
  }
  throw error;
}
initTelemetry(env);

const { buildApp } = await import('./app.js');

/**
 * Süreç giriş noktası: env doğrula → uygulamayı kur → dinle → zarifçe kapan.
 */
async function main(): Promise<void> {
  const app = await buildApp({ env });

  // SIGTERM/SIGINT: yeni bağlantı alma, in-flight istekleri bitir, kaynakları kapat.
  // Süre dolarsa süreç zorla sonlanır — asılı kalan bir pod deploy'u kilitler.
  closeWithGrace({ delay: env.SHUTDOWN_GRACE_MS }, async ({ signal, err }) => {
    if (err) {
      app.log.error({ err }, 'Yakalanmamış hata nedeniyle kapanılıyor');
    } else {
      app.log.info({ signal }, 'Kapanma sinyali alındı, zarif kapanış başlıyor');
    }
    await app.close();
    await shutdownTelemetry();
    app.log.info('Zarif kapanış tamamlandı');
  });

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (error) {
    app.log.fatal({ err: error }, 'Sunucu dinlemeye başlayamadı');
    process.exit(1);
  }
}

await main();
