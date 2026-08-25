import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ERROR_CODES, type ErrorCode } from '@klinara/shared';
import { AppError } from '../lib/errors.js';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';
const ERROR_BASE_URI = 'https://errors.klinara.app';

interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  instance: string;
  requestId: string;
  errors?: { path: string; message: string }[];
  [key: string]: unknown;
}

function typeUri(code: ErrorCode): string {
  return `${ERROR_BASE_URI}/${code.toLowerCase().replaceAll('_', '-')}`;
}

function buildProblem(
  request: FastifyRequest,
  status: number,
  code: ErrorCode,
  title: string,
  extras: Partial<ProblemDocument> = {},
): ProblemDocument {
  return {
    type: typeUri(code),
    title,
    status,
    code,
    instance: request.url,
    requestId: request.id,
    ...extras,
  };
}

/**
 * Zod doğrulama hatasının hangi alana ait olduğunu çıkarır.
 * `instancePath` gövde alanları için doludur; query/params gibi durumlarda
 * ham Zod issue'sundaki yola düşeriz.
 */
function issueFieldPath(issue: { instancePath?: string; params?: unknown }): string {
  const fromInstancePath = (issue.instancePath ?? '').replace(/^\//, '');
  if (fromInstancePath.length > 0) return fromInstancePath;
  const params = issue.params as { issue?: { path?: unknown[] } } | undefined;
  const path = params?.issue?.path;
  return Array.isArray(path) ? path.join('.') : '(gövde)';
}

/** Fastify'ın yerleşik hata kodlarını bizim enum'umuza eşler. */
function mapFastifyError(statusCode: number, fastifyCode: string | undefined): ErrorCode {
  if (fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE') return ERROR_CODES.VALIDATION_FAILED;
  if (statusCode === 400) return ERROR_CODES.VALIDATION_FAILED;
  if (statusCode === 401) return ERROR_CODES.UNAUTHENTICATED;
  if (statusCode === 403) return ERROR_CODES.FORBIDDEN;
  if (statusCode === 404) return ERROR_CODES.NOT_FOUND;
  if (statusCode === 409) return ERROR_CODES.CONFLICT;
  if (statusCode === 429) return ERROR_CODES.RATE_LIMITED;
  if (statusCode === 503) return ERROR_CODES.SERVICE_UNAVAILABLE;
  return ERROR_CODES.INTERNAL_ERROR;
}

/**
 * Merkezi hata katmanı — RFC 9457 `application/problem+json`.
 *
 * Tek kural: beklenmeyen hatalar istemciye SIZDIRILMAZ. İç mesaj, yığın izi,
 * SQL metni, tablo adı — hiçbiri gövdeye girmez. İstemci `requestId` alır,
 * ayrıntı logda kalır. Bu, hata mesajı üzerinden şema keşfini engeller.
 */
async function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    // 1) Zod şema doğrulama hataları → alan bazlı 400
    if (hasZodFastifySchemaValidationErrors(error)) {
      const problem = buildProblem(
        request,
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'Gönderilen veri geçersiz',
        {
          errors: error.validation.map((issue) => ({
            path: issueFieldPath(issue),
            message: issue.message ?? 'Geçersiz değer',
          })),
        },
      );
      request.log.info({ problem }, 'İstek doğrulaması başarısız');
      return reply.code(400).type(PROBLEM_CONTENT_TYPE).send(problem);
    }

    // 2) Bilinen uygulama hataları
    if (error instanceof AppError) {
      const problem = buildProblem(request, error.statusCode, error.code, error.message, {
        ...(error.detail !== undefined ? { detail: error.detail } : {}),
        ...error.extra,
      });
      // 5xx beklenen olsa bile ciddiye alınır; 4xx normal akışın parçasıdır.
      if (error.statusCode >= 500) {
        request.log.error({ err: error, problem }, 'Uygulama hatası (5xx)');
      } else {
        request.log.info({ problem }, 'Uygulama hatası (4xx)');
      }
      return reply.code(error.statusCode).type(PROBLEM_CONTENT_TYPE).send(problem);
    }

    // 3) Fastify / eklenti kaynaklı, status taşıyan hatalar
    const fastifyError = error as Partial<FastifyError>;
    const statusCode = fastifyError.statusCode ?? 500;
    if (statusCode < 500) {
      const code = mapFastifyError(statusCode, fastifyError.code);
      const problem = buildProblem(
        request,
        statusCode,
        code,
        fastifyError.message ?? 'İstek işlenemedi',
      );
      request.log.info({ problem }, 'İstemci hatası');
      return reply.code(statusCode).type(PROBLEM_CONTENT_TYPE).send(problem);
    }

    // 4) Beklenmeyen her şey → 500, ayrıntı SIZMAZ
    request.log.error({ err: error }, 'Beklenmeyen hata');
    const problem = buildProblem(
      request,
      500,
      ERROR_CODES.INTERNAL_ERROR,
      'Beklenmeyen bir hata oluştu',
      {
        detail:
          'Bu hata kaydedildi. Destekle iletişime geçerseniz requestId değerini paylaşın.',
      },
    );
    return reply.code(500).type(PROBLEM_CONTENT_TYPE).send(problem);
  });

  app.setNotFoundHandler((request, reply) => {
    const problem = buildProblem(request, 404, ERROR_CODES.NOT_FOUND, 'Uç bulunamadı', {
      detail: `${request.method} ${request.url} tanımlı değil.`,
    });
    return reply.code(404).type(PROBLEM_CONTENT_TYPE).send(problem);
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
