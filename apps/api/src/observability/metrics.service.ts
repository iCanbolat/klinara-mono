import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { EnvironmentVariables } from '../config/env.validation';

/**
 * Prometheus metrikleri.
 *
 * RED (Rate, Errors, Duration) metriklerine ek olarak iş metrikleri de burada
 * tanımlanır — "sistem ayakta ama randevu oluşmuyor" durumunu yalnız teknik
 * metriklerle göremezsiniz.
 */
@Injectable()
export class MetricsService {
  readonly registry: Registry;
  readonly httpDuration: Histogram<'method' | 'route' | 'status_code'>;

  /** Oluşturulan randevu sayısı. */
  readonly appointmentsCreated: Counter<'branch_id' | 'source'>;
  /** Veritabanı seviyesinde reddedilen çakışma sayısı. */
  readonly slotConflicts: Counter<'resource_type'>;
  /** Gönderilen bildirim sayısı. */
  readonly notificationsSent: Counter<'channel' | 'status'>;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ service: config.get('SERVICE_NAME', { infer: true }) });
    collectDefaultMetrics({ register: this.registry });

    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP istek süresi',
      labelNames: ['method', 'route', 'status_code'] as const,
      // Hedeflerimiz: randevu oluşturma p95 < 120ms, takvim < 150ms, uygunluk < 200ms.
      buckets: [0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.appointmentsCreated = new Counter({
      name: 'klinara_appointments_created_total',
      help: 'Oluşturulan randevu sayısı',
      labelNames: ['branch_id', 'source'] as const,
      registers: [this.registry],
    });

    this.slotConflicts = new Counter({
      name: 'klinara_slot_conflicts_total',
      help: 'Veritabanı seviyesinde reddedilen çakışma sayısı',
      labelNames: ['resource_type'] as const,
      registers: [this.registry],
    });

    this.notificationsSent = new Counter({
      name: 'klinara_notifications_total',
      help: 'Gönderilen bildirim sayısı',
      labelNames: ['channel', 'status'] as const,
      registers: [this.registry],
    });
  }
}
