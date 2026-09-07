import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { PinoLogger } from 'nestjs-pino';
import type pg from 'pg';
import type { EnvironmentVariables } from '../../config/env.validation';
import { PG_POOL } from '../../database/database.constants';

interface HitRow {
  total_hits: number | string;
  time_to_expire: number | string;
  is_blocked: boolean;
  time_to_block_expire: number | string;
}

/** Süresi geçmiş satırların temizlik aralığı. */
const SWEEP_INTERVAL_MS = 5 * 60_000;

/** Temizlikte "yeterince geçmiş" sayılan gecikme — yarıştaki isteği bozmamak için. */
const SWEEP_GRACE = "interval '1 hour'";

const toInt = (value: number | string): number =>
  typeof value === 'number' ? value : Number.parseInt(value, 10);

/**
 * PostgreSQL tabanlı dağıtık hız sınırı deposu (Batch 10.3).
 *
 * `@nestjs/throttler`ın varsayılan deposu bir `Map`tir: iki instance'ta her
 * biri kendi sayacını tutar ve dakikada 10 denemeye izin veren giriş ucu fiilen
 * 20'ye izin verir. Sayaç veritabanına taşındığında sınır instance sayısından
 * BAĞIMSIZ hâle gelir.
 *
 * ⚠️ VERİTABANI DÜŞERSE HIZ SINIRI DEĞİL, YALNIZ DAĞITIKLIĞI KAYBOLUR.
 * Hata durumunda süreç-içi sayaca düşülür. Alternatifi her isteği reddetmekti;
 * o, hız sınırı altyapısını uygulamanın kendisinden daha kritik bir bağımlılık
 * yapardı. Zaten veritabanı olmadan uçların çoğu çalışmıyor — koruma kalkanı
 * için tüm kapıyı kapatmanın karşılığı yok. Düşüş loglanır ve metriğe yazılır.
 */
@Injectable()
export class PgThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  /** Veritabanı erişilemediğinde devreye giren süreç-içi sayaç. */
  private readonly fallback = new ThrottlerStorageService();
  private readonly usePostgres: boolean;
  private lastSweepAt = 0;
  private degraded = false;

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly logger: PinoLogger,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.usePostgres = config.get('RATE_LIMIT_STORAGE', { infer: true }) === 'postgres';
    this.logger.setContext(PgThrottlerStorage.name);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.usePostgres) {
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }

    // Aynı anahtar farklı throttler'larda farklı sayılır (`default` ile uç
    // bazlı `@Throttle` aynı IP'yi ayrı bütçelerde tutar).
    const bucketKey = `${throttlerName}:${key}`;

    try {
      const { rows } = await this.pool.query<HitRow>(
        'select * from rate_limit_hit($1, $2, $3, $4)',
        [bucketKey, ttl, limit, blockDuration],
      );
      const row = rows[0];
      if (row === undefined) throw new Error('rate_limit_hit satır döndürmedi');

      if (this.degraded) {
        this.degraded = false;
        this.logger.warn('Hız sınırı sayacı veritabanına geri döndü');
      }
      this.sweepExpired();

      return {
        totalHits: toInt(row.total_hits),
        timeToExpire: toInt(row.time_to_expire),
        isBlocked: row.is_blocked,
        timeToBlockExpire: toInt(row.time_to_block_expire),
      };
    } catch (error) {
      if (!this.degraded) {
        this.degraded = true;
        this.logger.error(
          { err: error },
          'Hız sınırı sayacı veritabanına yazamadı; süreç-içi sayaca düşüldü',
        );
      }
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  /**
   * Süresi geçmiş satırları arada bir siler.
   *
   * Kuyruğa (pg-boss) bağlanmadı: hız sınırı, kuyruk KAPALIYKEN de çalışmak
   * zorunda olan bir korumadır ve temizliği ona bağlamak sessiz bir bağımlılık
   * yaratırdı. Silme beklenmez ve hatası yutulur — biriken satır bir performans
   * sorunudur, doğruluk sorunu değil.
   */
  private sweepExpired(): void {
    const now = Date.now();
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;

    void this.pool
      .query(`delete from rate_limit_counters where window_ends_at < now() - ${SWEEP_GRACE}`)
      .catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Hız sınırı sayaç temizliği başarısız');
      });
  }

  /** Yedek sayacın zamanlayıcıları süreci ayakta tutmasın. */
  onApplicationShutdown(): void {
    this.fallback.onApplicationShutdown();
  }
}
