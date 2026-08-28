import 'reflect-metadata';
import { loadEnvOrExit } from './config/load-env';
import { initTelemetry, shutdownTelemetry } from './observability/telemetry';

// Env'i telemetriden önce doğrula, telemetriyi diğer HER ŞEYDEN önce başlat:
// OpenTelemetry enstrümante edeceği modülleri (http, express, pg) yüklenirken
// yamalar — bu yüzden aşağıdaki import'lar dinamiktir.
const env = loadEnvOrExit();
initTelemetry(env);

/**
 * SIGTERM/SIGINT: yeni bağlantı alma, in-flight istekleri bitir, kaynakları kapat.
 * Süre dolarsa süreç ZORLA sonlanır — asılı kalan bir pod deploy'u kilitler.
 */
function installShutdownHandlers(close: () => Promise<void>, graceMs: number): void {
  let closing = false;
  const handle = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;

    const watchdog = setTimeout(() => {
      process.stderr.write(
        `[klinara-api] ${signal} sonrası ${graceMs}ms doldu, zorla kapanılıyor\n`,
      );
      process.exit(1);
    }, graceMs);
    // Kapanış zamanında biterse timer süreci ayakta tutmasın.
    watchdog.unref();

    void close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        process.stderr.write(`[klinara-api] Kapanış hatası\n${String(error)}\n`);
        process.exit(1);
      });
  };

  process.once('SIGTERM', handle);
  process.once('SIGINT', handle);
}

async function bootstrap(): Promise<void> {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');
  const { configureApp } = await import('./configure-app');

  const app = await NestFactory.create<import('@nestjs/platform-express').NestExpressApplication>(
    AppModule,
    // `rawBody`: WhatsApp webhook imzası (8.3) gövdenin HAM baytları üzerinden
    // doğrulanır. Parse edilip yeniden serialize edilmiş gövde başka bir imza
    // üretir ve doğrulama sessizce başarısız olur.
    { bufferLogs: true, rawBody: true },
  );

  configureApp(app);

  installShutdownHandlers(async () => {
    // Sıra önemli: önce HTTP kapanır ve in-flight istekler biter, sonra
    // veritabanı havuzu (Nest lifecycle hook'u), en son telemetri boşaltılır.
    await app.close();
    await shutdownTelemetry();
  }, env.SHUTDOWN_GRACE_MS);

  await app.listen(env.PORT, env.HOST);
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`\n[klinara-api] AÇILIŞ BAŞARISIZ\n${String(error)}\n\n`);
  process.exit(1);
});
