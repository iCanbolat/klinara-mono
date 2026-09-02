import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import * as repo from './domains.repository';
import { applyCheckResult } from './domains.service';
import { checkDomainOwnership, systemResolver, type DnsLookup } from './domain-verifier';

interface TenantJob {
  tenantId: string;
}

/**
 * Özel alan adlarının DNS doğrulamasını yürüten süpürücü.
 *
 * İki adım (`PackageExpiryWorker` ile aynı gerekçe): cron yalnız KİRACILARI
 * listeler, asıl kontrol kiracı başına ayrı bir işte ve RLS altında koşar. Tek
 * job'da tüm kiracıları gezmek, bir kiracının yavaş çözümleyicisinin
 * diğerlerini de bekletmesi demekti.
 *
 * Kiracı LİSTESİ `runAsSystem` ile okunuyor — bu, o bayrağın sözleşmesine
 * uygun tek kullanım biçimi. `app.public_flow` burada KULLANILMAZ: worker'ın
 * kiracıyı zaten biliyor olması gerekiyor, çözümlemeye ihtiyacı yok.
 */
@Injectable()
export class DomainVerifyWorker implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly tx: TenantTxService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.queue.register(QUEUES.BOOKING_DOMAIN_VERIFY_SWEEP, async () => {
      await this.sweep();
    });
    this.queue.register(QUEUES.BOOKING_DOMAIN_VERIFY_TENANT, async (jobs) => {
      for (const job of jobs) await this.verifyTenant((job.data as TenantJob).tenantId);
    });
  }

  async sweep(): Promise<number> {
    const tenantIds = await this.tx.runAsSystem(async (tx) => {
      // Kiracı listesi `tenants` üzerinden okunuyor; `booking_site_domains`
      // platform bayrağına açık değil, bu yüzden filtreleme kiracı işinde
      // yapılır. Birkaç boş iş, izolasyonu gevşetmekten ucuz.
      const result = await tx.execute<{ id: string }>(sql`
        select id from tenants where status in ('trial', 'active') and deleted_at is null
      `);
      return result.rows.map((row) => row.id);
    });

    for (const tenantId of tenantIds) {
      await this.tx.runForTenant(tenantId, async (tx) => {
        await this.queue.send(
          tx,
          QUEUES.BOOKING_DOMAIN_VERIFY_TENANT,
          { tenantId },
          { singletonKey: `domain-verify:${tenantId}` },
        );
      });
    }
    return tenantIds.length;
  }

  /** Bir kiracının bekleyen alan adlarını kontrol eder. */
  async verifyTenant(tenantId: string, lookup: DnsLookup = systemResolver()): Promise<number> {
    const pending = await this.tx.runForTenant(tenantId, (tx) => repo.listPendingDomains(tx));
    if (pending.length === 0) return 0;

    const maxAttempts = this.config.get('BOOKING_DOMAIN_MAX_CHECK_ATTEMPTS', { infer: true });
    let checked = 0;

    for (const domain of pending) {
      // DNS sorgusu transaction DIŞINDA: ağ gecikmesi boyunca bir veritabanı
      // bağlantısını tutmak, yavaş bir çözümleyicinin havuzu tüketmesi demekti.
      const result = await checkDomainOwnership(lookup, {
        host: domain.host,
        token: domain.verificationToken,
        dnsTarget: domain.dnsTarget,
      });

      await this.tx.runForTenant(tenantId, (tx) =>
        applyCheckResult(tx, domain, result, maxAttempts),
      );
      checked += 1;

      if (result.verified) {
        this.logger.info({ host: domain.host, tenantId }, 'Alan adı DNS doğrulaması geçti');
      }
    }
    return checked;
  }
}
