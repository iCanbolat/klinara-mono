import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Request, Response } from 'express';
import { ERROR_CODES, type ErrorCode } from '@klinara/shared';
import { AppError } from '../errors/app-error';
import { requestIdOf } from '../request-context';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';
const ERROR_BASE_URI = 'https://errors.klinara.app';

export interface ProblemDocument {
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

/**
 * HTTP durum kodunu makine okunur hata koduna eşler.
 *
 * Nest/Express kaynaklı hatalar (404, 413, 415 ...) da istemciye AYNI
 * sözleşmeyle döner; istemci tek bir `code` alanına bakar.
 */
const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: ERROR_CODES.VALIDATION_FAILED,
  401: ERROR_CODES.UNAUTHENTICATED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  413: ERROR_CODES.VALIDATION_FAILED,
  415: ERROR_CODES.VALIDATION_FAILED,
  429: ERROR_CODES.RATE_LIMITED,
  503: ERROR_CODES.SERVICE_UNAVAILABLE,
};

function codeForStatus(status: number): ErrorCode {
  return CODE_BY_STATUS[status] ?? ERROR_CODES.INTERNAL_ERROR;
}

/** `HttpException` gövdesinden insana yönelik başlığı çıkarır. */
function titleOf(exception: HttpException): string {
  const response: unknown = exception.getResponse();
  if (typeof response === 'string') return response;
  if (response !== null && typeof response === 'object') {
    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return exception.message;
}

/**
 * Merkezi hata katmanı — RFC 9457 `application/problem+json`.
 *
 * Tek kural: beklenmeyen hatalar istemciye SIZDIRILMAZ. İç mesaj, yığın izi,
 * SQL metni, tablo adı — hiçbiri gövdeye girmez. İstemci `requestId` alır,
 * ayrıntı logda kalır. Bu, hata mesajı üzerinden şema keşfini engeller.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(ProblemDetailsFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const problem = this.toProblem(exception, request);
    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
  }

  private build(
    request: Request,
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
      instance: request.originalUrl,
      requestId: requestIdOf(request),
      ...extras,
    };
  }

  private toProblem(exception: unknown, request: Request): ProblemDocument {
    // 1) Bilinen uygulama hataları (doğrulama hataları da buraya düşer).
    if (exception instanceof AppError) {
      const problem = this.build(request, exception.statusCode, exception.code, exception.message, {
        ...(exception.detail !== undefined ? { detail: exception.detail } : {}),
        ...exception.extra,
      });
      // 5xx beklenen olsa bile ciddiye alınır; 4xx normal akışın parçasıdır.
      if (exception.statusCode >= 500) {
        this.logger.error({ err: exception, problem }, 'Uygulama hatası (5xx)');
      } else {
        this.logger.info({ problem }, 'Uygulama hatası (4xx)');
      }
      return problem;
    }

    // 2) Nest / Express kaynaklı, status taşıyan hatalar (404, 413, 415 ...).
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status < 500) {
        const problem = this.build(request, status, codeForStatus(status), titleOf(exception));
        this.logger.info({ problem }, 'İstemci hatası');
        return problem;
      }
      this.logger.error({ err: exception }, 'Sunucu hatası');
    } else {
      // 3) Beklenmeyen her şey → 500, ayrıntı SIZMAZ.
      this.logger.error({ err: exception }, 'Beklenmeyen hata');
    }

    return this.build(
      request,
      HttpStatus.INTERNAL_SERVER_ERROR,
      ERROR_CODES.INTERNAL_ERROR,
      'Beklenmeyen bir hata oluştu',
      { detail: 'Bu hata kaydedildi. Destekle iletişime geçerseniz requestId değerini paylaşın.' },
    );
  }
}
