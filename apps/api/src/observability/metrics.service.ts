import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
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

  /**
   * Süreç-içi cache isabet/ıska sayacı (Batch 10.2).
   *
   * Üç cache de tek instance varsayımıyla yazıldı (`AvailabilityCacheService`,
   * `PrincipalService`, `BranchAccessService`) ve 10.3'te `LISTEN/NOTIFY` ile
   * dağıtık invalidasyona bağlanacak. O işin ÖNCESİNDE isabet oranının
   * ölçülmesi gerekiyor: invalidasyon yayını eklendiğinde isabet oranının
   * düşüp düşmediği ancak bugünkü taban çizgisi bilinirse anlaşılır.
   */
  readonly cacheEvents: Counter<'cache' | 'result'>;

  /**
   * Veritabanı havuzu doygunluğu.
   *
   * `waiting > 0` havuzun tükendiği demektir ve bu, gecikmenin sorgu
   * yavaşlığından DEĞİL bağlantı beklemesinden geldiği tek durumdur —
   * `http_request_duration_seconds` ikisini ayırt edemez.
   */
  readonly dbPoolConnections: Gauge<'state'>;

  /** pg-boss kuyruk derinliği (10.4 uyarı kuralının kaynağı). */
  readonly queueDepth: Gauge<'queue' | 'state'>;

  /**
   * Aşırı yük ölçümü (Batch 10.3): event loop gecikmesi, heap doluluğu ve
   * korumanın devrede olup olmadığı.
   *
   * 503 dönen bir API'de ilk soru "neden" olur; bu üç sayı olmadan cevap
   * ancak süreçten dışarı sızan bir tahmindir.
   */
  readonly overload: Gauge<'signal'>;

  /** `PoolMetricsService` tarafından takılır; bkz. `dbPoolConnections`. */
  private poolSampler: ((gauge: Gauge<'state'>) => void) | undefined;

  /** `OverloadMetricsService` tarafından takılır; bkz. `overload`. */
  private overloadSampler: ((gauge: Gauge<'signal'>) => void) | undefined;

  setOverloadSampler(sampler: (gauge: Gauge<'signal'>) => void): void {
    this.overloadSampler = sampler;
  }

  /** Havuz örnekleyicisini takar. Tek çağıranı `PoolMetricsService`tir. */
  setPoolSampler(sampler: (gauge: Gauge<'state'>) => void): void {
    this.poolSampler = sampler;
  }

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

    this.cacheEvents = new Counter({
      name: 'klinara_cache_events_total',
      help: 'Süreç-içi cache isabet/ıska sayısı',
      labelNames: ['cache', 'result'] as const,
      registers: [this.registry],
    });

    this.dbPoolConnections = new Gauge({
      name: 'klinara_db_pool_connections',
      help: 'Veritabanı havuzu bağlantı sayısı (total/idle/waiting)',
      labelNames: ['state'] as const,
      registers: [this.registry],
      // Örnekleme SCRAPE ANINDA yapılır, zamanlayıcıyla değil: periyodik bir
      // `setInterval` kimse bakmıyorken de çalışır ve iki scrape arasındaki
      // tepe değerini kaçırır. Havuzun kendisi burada erişilebilir olmadığı
      // için gerçek örnekleyiciyi `PoolMetricsService` takıyor; takılmadığı
      // sürece (ör. havuzsuz birim testi) metrik boş kalır, patlamaz.
      collect: (): void => {
        this.poolSampler?.(this.dbPoolConnections);
      },
    });

    this.queueDepth = new Gauge({
      name: 'klinara_queue_depth',
      help: 'Kuyruktaki iş sayısı',
      labelNames: ['queue', 'state'] as const,
      registers: [this.registry],
    });

    this.overload = new Gauge({
      name: 'klinara_overload',
      help: 'Aşırı yük sinyalleri: event_loop_delay_ms, heap_used_ratio, active',
      labelNames: ['signal'] as const,
      registers: [this.registry],
      // Havuz metriğiyle aynı sebeple scrape anında: son örneklemenin
      // sonucunu okur, yeni bir ölçüm başlatmaz.
      collect: (): void => {
        this.overloadSampler?.(this.overload);
      },
    });
  }
}
