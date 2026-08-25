import { trace } from '@opentelemetry/api';
import type { Params } from 'nestjs-pino';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';
import { resolveRequestId } from '../common/request-context';
import { getLogStream } from './log-stream';
import { REDACT_PATHS, censor } from './redaction';

/**
 * pino yapılandırması: JSON log, gizleme (redaction) ve trace korelasyonu.
 *
 * `genReqId` istemcinin gönderdiği `x-request-id`i korur — böylece bir isteğin
 * log satırı, trace'i ve hata yanıtı AYNI kimlik üzerinden eşleşir.
 */
export function buildLoggerParams(config: ConfigService<EnvironmentVariables, true>): Params {
  const isDevelopment = config.get('NODE_ENV', { infer: true }) === 'development';

  const options = {
    level: config.get('LOG_LEVEL', { infer: true }),
    // Sırlar loga hiç girmez; telefon gibi kişisel veriler maskelenir.
    redact: { paths: REDACT_PATHS, censor },
    genReqId: (req: { id?: unknown; headers: Record<string, unknown> }) => resolveRequestId(req),
    // Log satırını aktif trace ile ilişkilendir: bir isteğin logu ve trace'i
    // aynı id üzerinden bulunabilsin.
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const ctx = span.spanContext();
      return { traceId: ctx.traceId, spanId: ctx.spanId };
    },
    ...(isDevelopment
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };

  const stream = getLogStream();
  return { pinoHttp: stream !== undefined ? [options, stream] : options };
}
