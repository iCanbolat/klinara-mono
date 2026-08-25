import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import * as Sentry from '@sentry/node';
import type { Env } from './config/env.js';

let sdk: NodeSDK | undefined;

/**
 * Telemetriyi başlatır. `server.ts`te İLK import olmalıdır — OpenTelemetry
 * modülleri yüklenirken yamalar (pg, http, fastify), dolayısıyla enstrümante
 * edeceği modüller ondan SONRA import edilmelidir.
 *
 * Her ikisi de opt-in: ilgili env değişkeni yoksa hiç kurulmaz. Böylece yerel
 * geliştirme ve testler ek altyapı gerektirmez.
 */
export function initTelemetry(env: Env): void {
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined) {
    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: env.SERVICE_NAME,
        [ATTR_SERVICE_VERSION]: env.SERVICE_VERSION,
      }),
      traceExporter: new OTLPTraceExporter({
        url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Dosya sistemi izleri gürültüden ibaret, kapalı.
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });
    sdk.start();
  }

  if (env.SENTRY_DSN !== undefined) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      release: env.SERVICE_VERSION,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
      // KVKK: kişisel veri Sentry'ye GÖNDERİLMEZ.
      sendDefaultPii: false,
      beforeSend(event) {
        // İstek gövdesi hasta verisi taşıyabilir; hiç göndermiyoruz.
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
          }
        }
        return event;
      },
    });
  }
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
  await Sentry.close(2_000);
}
