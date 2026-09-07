import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from '../database/database.constants';
import { MetricsService } from './metrics.service';

/**
 * Veritabanı havuzunun doygunluğunu `/metrics`e bağlar (Batch 10.2).
 *
 * Örnekleme SCRAPE ANINDA yapılıyor (`Gauge.collect`), zamanlayıcıyla değil.
 * Periyodik bir `setInterval` iki şeyi birden yanlış yapardı: kimse
 * bakmıyorken de çalışır, ve iki scrape arasındaki tepe değerini kaçırır.
 * `collect` ise Prometheus'un sorduğu anın gerçeğini verir ve süreç boştayken
 * hiç iş yapmaz.
 *
 * Ölçülen üç sayı `pg.Pool`un kendi alanlarıdır:
 *   total   — açılmış bağlantı (idle dahil)
 *   idle    — boşta bekleyen
 *   waiting — BAĞLANTI BEKLEYEN İSTEK. Bu sıfırdan büyükse gecikmenin
 *             kaynağı sorgu değil havuzdur; `http_request_duration_seconds`
 *             tek başına bu ayrımı yapamaz ve "veritabanı yavaşladı" diye
 *             yanlış teşhis edilir.
 */
@Injectable()
export class PoolMetricsService implements OnModuleInit {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    const pool = this.pool;

    this.metrics.setPoolSampler((gauge) => {
      gauge.set({ state: 'total' }, pool.totalCount);
      gauge.set({ state: 'idle' }, pool.idleCount);
      gauge.set({ state: 'waiting' }, pool.waitingCount);
    });
  }
}
