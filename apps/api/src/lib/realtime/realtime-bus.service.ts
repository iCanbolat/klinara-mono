import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { Client } from 'pg';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { Tx } from '../../database/tenant-tx';

const CHANNEL = 'klinara_realtime';
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Yayına çıkan olay. İÇERİK TAŞIMAZ — yalnız "şu klinikte şu türden bir şey
 * oldu" der; istemci asıl veriyi yetkili REST ucundan okur. Böylece yetki ve
 * şube süzgeci tek bir yerde (REST) kalıyor, yayın katmanı veri sızdıramıyor.
 */
export interface RealtimeEvent {
  tenantId: string;
  /** `null`: klinik geneli — şubeden bağımsız herkese gider. */
  branchId: string | null;
  type: 'staff_notification';
  kind: string;
}

type EventListener = (event: RealtimeEvent) => void;
type ResyncListener = () => void;

/**
 * Süreçler arası olay yolu — Postgres `LISTEN/NOTIFY`.
 *
 * **Neden Postgres:** `publish(tx, …)` çağıranın transaction'ına yazar ve
 * `NOTIFY` yalnız COMMIT'te teslim edilir. Rollback olan randevunun olayı hiç
 * yayınlanmaz; kuyruktaki işlerle (`QueueService.send`) aynı atomiklik, ek bir
 * altyapı (Redis) olmadan. Olay hangi instance'ta ya da worker'da doğarsa
 * doğsun, soketi tutan instance'a ulaşır.
 *
 * ⚠️ `LISTEN` OTURUMA bağlıdır: araya transaction modunda bir PgBouncer
 * girerse dinleme sessizce çalışmaz. Dinleyici bağlantısı doğrudan Postgres'e
 * gitmelidir.
 */
@Injectable()
export class RealtimeBusService implements OnApplicationBootstrap, OnModuleDestroy {
  private client: Client | undefined;
  private closed = false;
  private retryMs = RECONNECT_MIN_MS;
  private retryTimer: NodeJS.Timeout | undefined;
  private readonly eventListeners = new Set<EventListener>();
  private readonly resyncListeners = new Set<ResyncListener>();

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly logger: PinoLogger,
  ) {}

  /** Olayı ÇAĞIRANIN transaction'ına yazar; commit'te yayınlanır. */
  async publish(tx: Tx, event: RealtimeEvent): Promise<void> {
    await tx.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(event)})`);
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Dinleyici bağlantısı koptuktan sonra yeniden kurulduğunda çağrılır: arada
   * kaçan olaylar bilinemez, istemciler verilerini baştan okumalıdır.
   */
  onResync(listener: ResyncListener): () => void {
    this.resyncListeners.add(listener);
    return () => this.resyncListeners.delete(listener);
  }

  onApplicationBootstrap(): void {
    // Açılışı BEKLETMEZ ve düşürmez: veritabanı o an yoksa API yine açılır
    // (readiness ayrı raporlar), dinleyici arka planda yeniden dener.
    void this.connect(false);
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => undefined);
  }

  private async connect(isReconnect: boolean): Promise<void> {
    if (this.closed) return;
    const client = new Client({
      connectionString: this.config.get('DATABASE_URL', { infer: true }),
      application_name: 'klinara-api-realtime',
      keepAlive: true,
    });

    let lost = false;
    const onLost = (error?: Error): void => {
      if (lost) return;
      lost = true;
      if (this.client === client) this.client = undefined;
      void client.end().catch(() => undefined);
      if (this.closed) return;
      this.logger.warn({ err: error, retryMs: this.retryMs }, 'Yayın dinleyicisi koptu');
      this.retryTimer = setTimeout(() => void this.connect(true), this.retryMs);
      this.retryTimer.unref();
      this.retryMs = Math.min(this.retryMs * 2, RECONNECT_MAX_MS);
    };

    // Dinleyici YOKSA kopan bağlantının 'error'u süreci öldürür (bkz. havuz).
    client.on('error', onLost);
    client.on('end', () => onLost());
    client.on('notification', (message) => {
      if (message.channel !== CHANNEL || message.payload === undefined) return;
      this.dispatch(message.payload);
    });

    try {
      await client.connect();
      await client.query(`listen ${CHANNEL}`);
    } catch (error: unknown) {
      onLost(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    if (this.closed) {
      await client.end().catch(() => undefined);
      return;
    }
    this.client = client;
    this.retryMs = RECONNECT_MIN_MS;
    if (isReconnect) {
      this.logger.info('Yayın dinleyicisi yeniden bağlandı');
      for (const listener of this.resyncListeners) listener();
    }
  }

  private dispatch(payload: string): void {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(payload) as RealtimeEvent;
    } catch {
      return;
    }
    if (typeof event.tenantId !== 'string' || typeof event.type !== 'string') return;
    for (const listener of this.eventListeners) listener(event);
  }
}
