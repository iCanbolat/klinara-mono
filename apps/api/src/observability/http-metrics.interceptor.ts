import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { finalize } from 'rxjs/operators';
import type { Observable } from 'rxjs';
import { MetricsService } from './metrics.service';

/** Express'in eşleşen rota şablonu (`/api/v1/branches/:id`). */
function routeTemplate(request: Request): string {
  const route = (request as { route?: { path?: unknown } }).route;
  if (route !== undefined && typeof route.path === 'string') {
    // Global prefix router seviyesinde uygulandığı için `baseUrl` ile birleştirilir.
    return `${request.baseUrl}${route.path}` || route.path;
  }
  return 'unknown';
}

/**
 * RED metriklerini toplar.
 *
 * Ham URL değil ROTA ŞABLONU etiketlenir (`/customers/:id`); aksi hâlde her
 * uuid ayrı bir zaman serisi yaratır ve Prometheus'u patlatır.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      finalize(() => {
        const route = routeTemplate(request);
        if (route === '/metrics') return;
        const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        this.metrics.httpDuration.observe(
          { method: request.method, route, status_code: String(response.statusCode) },
          seconds,
        );
      }),
    );
  }
}
