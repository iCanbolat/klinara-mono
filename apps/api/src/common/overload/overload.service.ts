import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { EnvironmentVariables } from '../../config/env.validation';

export interface OverloadSnapshot {
  /** Örnekleme penceresindeki event loop gecikmesi p99'u (ms). */
  eventLoopDelayMs: number;
  /** Kullanılan heap / heap üst sınırı. */
  heapUsedRatio: number;
  overloaded: boolean;
  reason: 'event-loop' | 'heap' | null;
}

/**
 * Aşırı yük ölçümü — Faz 0'dan devreden açık madde (bkz. Ek B).
 *
 * Fastify'ın `@fastify/under-pressure`ının NestJS/Express karşılığı yok; bu
 * servis onun iki ölçütünü alır:
 *
 *   - **Event loop gecikmesi.** Süreç CPU'ya boğulduğunda istekler kuyrukta
 *     bekler. Gecikme, "istek başına süre"den ÖNCE bozulur ve tek instance'ın
 *     kapasitesinin dolduğunu gösteren en erken sinyaldir.
 *   - **Heap doluluğu.** Üst sınıra dayanmış bir süreç önce yavaşlar (GC),
 *     sonra ÖLÜR. Ölmesi, in-flight tüm istekleri kaybetmek demektir.
 *
 * Ölçüm periyodiktir ve pencere her örneklemede SIFIRLANIR: histogram
 * sıfırlanmazsa bir kez yaşanan tepe değeri süreç ömrü boyunca "hâlâ aşırı
 * yük altındayız" der ve koruma bir daha asla kalkmazdı.
 */
@Injectable()
export class OverloadService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly enabled: boolean;
  private readonly maxEventLoopDelayMs: number;
  private readonly maxHeapUsedRatio: number;
  private readonly sampleIntervalMs: number;

  private histogram: IntervalHistogram | undefined;
  private timer: NodeJS.Timeout | undefined;
  private snapshot: OverloadSnapshot = {
    eventLoopDelayMs: 0,
    heapUsedRatio: 0,
    overloaded: false,
    reason: null,
  };

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly logger: PinoLogger,
  ) {
    this.enabled = config.get('OVERLOAD_PROTECTION_ENABLED', { infer: true });
    this.maxEventLoopDelayMs = config.get('OVERLOAD_MAX_EVENT_LOOP_DELAY_MS', { infer: true });
    this.maxHeapUsedRatio = config.get('OVERLOAD_MAX_HEAP_USED_RATIO', { infer: true });
    this.sampleIntervalMs = config.get('OVERLOAD_SAMPLE_INTERVAL_MS', { infer: true });
    this.logger.setContext(OverloadService.name);
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.histogram = monitorEventLoopDelay({ resolution: 20 });
    this.histogram.enable();
    this.timer = setInterval(() => this.sample(), this.sampleIntervalMs);
    // Ölçüm süreci AYAKTA TUTMAMALI: aksi hâlde SIGTERM sonrası zarif kapanış
    // bu zamanlayıcı yüzünden bekler.
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.histogram?.disable();
  }

  /** Guard'ın sorduğu tek soru. */
  get isOverloaded(): boolean {
    return this.snapshot.overloaded;
  }

  get current(): OverloadSnapshot {
    return this.snapshot;
  }

  /** Test ve `/metrics` için: örneklemeyi zamanlayıcıyı beklemeden tetikler. */
  sample(): OverloadSnapshot {
    const heap = getHeapStatistics();
    const heapUsedRatio = heap.heap_size_limit > 0 ? heap.used_heap_size / heap.heap_size_limit : 0;

    // p99: ortalama, kısa ama derin bir duraklamayı gizler; maksimum ise tek
    // bir açılış duraklamasına takılıp kalır.
    const eventLoopDelayMs =
      this.histogram === undefined ? 0 : this.histogram.percentile(99) / 1e6;
    this.histogram?.reset();

    const reason: OverloadSnapshot['reason'] =
      eventLoopDelayMs > this.maxEventLoopDelayMs
        ? 'event-loop'
        : heapUsedRatio > this.maxHeapUsedRatio
          ? 'heap'
          : null;

    const next: OverloadSnapshot = {
      eventLoopDelayMs,
      heapUsedRatio,
      overloaded: reason !== null,
      reason,
    };

    if (next.overloaded !== this.snapshot.overloaded) {
      const message = next.overloaded
        ? 'Aşırı yük: yeni istekler 503 ile reddediliyor'
        : 'Aşırı yük durumu geçti; istekler normal kabul ediliyor';
      this.logger.warn(
        { eventLoopDelayMs, heapUsedRatio, reason },
        message,
      );
    }

    this.snapshot = next;
    return next;
  }
}
