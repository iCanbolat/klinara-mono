import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { Client } from 'pg';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { Tx } from '../../database/tenant-tx';
import { ALL_QUEUES, type QueueName } from './queue.constants';

type Handler = (jobs: { data: unknown }[]) => Promise<void>;

/**
 * pg-boss çekirdeği.
 *
 * **Neden ayrı bir kuyruk servisi yok da pg-boss var:** iş kuyruğunun kendi
 * veritabanımızda durması, job yazımının iş transaction'ıyla ATOMİK olmasını
 * sağlıyor (mimari karar 4.6). `send(tx, …)` işi çağıranın transaction'ına
 * yazar: iş rollback olursa job da olmaz. Outbox pattern'e bu yüzden gerek yok.
 *
 * **Neden owner bağlantısı:** pg-boss kendi şemasını ve migration'larını kendi
 * yönetir, yani DDL yetkisi ister. Uygulama rolü (`NOBYPASSRLS`) bunu yapamaz.
 * Kuyruk tabloları kiracı verisi TAŞIMAZ — job yükleri yalnız kimliklerden
 * oluşur, içerik her zaman işin kendi transaction'ında RLS altında okunur.
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnApplicationShutdown {
  private boss: PgBoss | undefined;
  private readonly handlers = new Map<QueueName, Handler>();
  private started = false;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly logger: PinoLogger,
  ) {}

  /** İşleyiciler modül kurulumunda kaydedilir; kuyruk açılışta bağlanır. */
  register(queue: QueueName, handler: Handler): void {
    this.handlers.set(queue, handler);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('QUEUE_ENABLED', { infer: true })) {
      this.logger.info('Kuyruk kapalı (QUEUE_ENABLED=false)');
      return;
    }

    const schema = this.config.get('QUEUE_SCHEMA', { infer: true });
    const appUrl = this.config.get('DATABASE_URL', { infer: true });
    const ownerUrl = this.config.get('DATABASE_MIGRATION_URL', { infer: true });
    const connectionString: string = ownerUrl ?? appUrl;

    const boss = new PgBoss({ connectionString, schema });
    boss.on('error', (error: unknown) => {
      this.logger.error({ err: error }, 'Kuyruk hatası');
    });

    await boss.start();
    for (const queue of ALL_QUEUES) await boss.createQueue(queue);

    // Uygulama rolü job yazabilmeli: `send(tx, …)` işi UYGULAMA bağlantısından
    // yazıyor, kuyruğun kendi havuzundan değil — atomikliğin bedeli bu.
    await QueueService.grantAppRole(connectionString, schema, appUrl);

    for (const [queue, handler] of this.handlers) {
      await boss.work(queue, handler);
    }

    this.boss = boss;
    this.started = true;
    this.logger.info({ schema, queues: ALL_QUEUES.length }, 'Kuyruk başlatıldı');
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.boss === undefined) return;
    await this.boss.stop({ graceful: true });
    this.boss = undefined;
    this.started = false;
  }

  /**
   * İşi ÇAĞIRANIN transaction'ına yazar.
   *
   * Kuyruk kapalıysa sessizce atlanır — testlerde ve kuyruksuz bir ortamda
   * iş akışının kendisi çalışmaya devam etmeli.
   */
  async send(tx: Tx, queue: QueueName, data: object, options: object = {}): Promise<void> {
    if (!this.started || this.boss === undefined) return;
    await this.boss.send(queue, data, { ...options, db: fromDrizzle(tx, sql) });
  }

  private static async grantAppRole(
    ownerUrl: string,
    schema: string,
    appUrl: string,
  ): Promise<void> {
    const role = new URL(appUrl).username;
    if (role === '' || role === new URL(ownerUrl).username) return;

    const quotedRole = `"${role.replace(/"/g, '""')}"`;
    const quotedSchema = `"${schema.replace(/"/g, '""')}"`;

    // Ayrı bir bağlantı: pg-boss havuzunu DDL için ödünç almak yerine tek
    // seferlik bir istemci açıp kapatmak hem daha okunur hem de pg-boss'un
    // içselleriyle bağ kurmuyor.
    const client = new Client({ connectionString: ownerUrl });
    await client.connect();
    try {
      await client.query(`grant usage on schema ${quotedSchema} to ${quotedRole}`);
      await client.query(
        `grant select, insert, update, delete on all tables in schema ${quotedSchema} to ${quotedRole}`,
      );
      await client.query(
        `grant usage, select on all sequences in schema ${quotedSchema} to ${quotedRole}`,
      );
      // pg-boss kuyruk başına tablo (partition) açıyor; sonradan doğanlar da
      // yetkili olmalı.
      await client.query(
        `alter default privileges in schema ${quotedSchema} grant select, insert, update, delete on tables to ${quotedRole}`,
      );
    } finally {
      await client.end();
    }
  }
}
