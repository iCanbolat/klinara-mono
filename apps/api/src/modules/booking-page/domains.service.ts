import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { isPlatformHost, normalizeHost } from '../../common/host';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { BookingSiteProvisioner } from './booking-site.provisioner';
import * as repo from './domains.repository';
import { newVerificationToken } from './verification-token';
import { checkDomainOwnership, systemResolver, VERIFY_TXT_PREFIX, type DnsLookup } from './domain-verifier';
import type { CreateDomainDto, DnsInstructionsDto, DomainDto } from './dto/domain.dto';

@Injectable()
export class DomainsService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly provisioner: BookingSiteProvisioner,
  ) {}

  async list(): Promise<DomainDto[]> {
    const rows = await this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      return repo.listDomains(tx, site.id);
    });
    return rows.map((row) => this.present(row));
  }

  async add(input: CreateDomainDto): Promise<DomainDto> {
    const host = normalizeHost(input.host);
    if (host === undefined) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Geçersiz alan adı', {
        detail: 'Örnek: randevu.klinigim.com — şema, yol ve port içermemeli.',
      });
    }

    const rootDomain = this.config.get('PUBLIC_BOOKING_DOMAIN', { infer: true });
    if (isPlatformHost(host, rootDomain)) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Bu alan adı platforma ait', {
        detail: `${rootDomain} altındaki adresler özel alan adı olarak eklenemez.`,
      });
    }

    const row = await this.tx
      .run(async (tx) => {
        const site = await this.provisioner.ensure(tx);
        const created = await repo.insertDomain(tx, {
          tenantId: this.tx.tenantId,
          bookingSiteId: site.id,
          host,
          kind: 'custom',
          verificationToken: newVerificationToken(),
          dnsTarget: this.dnsTargetFor(site.slug),
        });

        // Birincil BAYRAK burada yazılmıyor: doğrulanmamış bir alan adını
        // kanonik adres yapmak, kliniğin kanonik adresini erişilemez bir
        // konak adına taşımak olurdu. Terfi doğrulama tamamlanınca
        // `setPrimary` ile yapılır.
        return created;
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
          // Hangi kiracının aldığını SÖYLEMİYORUZ: bu uç, bir rakibin hangi
          // alan adlarının Klinara'da kayıtlı olduğunu taramasına yarayabilirdi.
          throw AppError.conflict(ERROR_CODES.HOST_TAKEN, 'Bu alan adı kullanılıyor', {
            detail: 'Bu adres başka bir hesapta kayıtlı. Doğru hesapta olduğunuzdan emin olun.',
          });
        }
        if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
          throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Bu alan adı kullanılamaz', {
            detail: 'Rezerve edilmiş ya da platforma ait bir adres.',
          });
        }
        throw error;
      });

    return this.present(row);
  }

  async remove(domainId: string): Promise<void> {
    await this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      const domain = await repo.findDomain(tx, site.id, domainId);
      if (domain === undefined) throw AppError.notFound('Alan adı bulunamadı');
      if (domain.kind === 'platform_subdomain') {
        throw AppError.forbidden('Platform adresi kaldırılamaz', {
          detail: 'Kliniğin kanonik adresi her zaman erişilebilir kalmalı.',
        });
      }

      await repo.deleteDomain(tx, domainId);
      // Kaldırılan alan adı birincil ise kanonik adres platform subdomain'ine
      // döner; aksi hâlde site birincil host'suz kalır ve `canonicalUrl` boşa
      // düşerdi.
      if (domain.isPrimary) {
        const remaining = await repo.listDomains(tx, site.id);
        const fallback =
          remaining.find((row) => row.kind === 'platform_subdomain') ?? remaining[0];
        if (fallback !== undefined) await repo.updateDomain(tx, fallback.id, { isPrimary: true });
      }
    });
  }

  /**
   * Elle doğrulama — kullanıcı "kontrol et"e bastığında.
   *
   * Süpürücü zaten beş dakikada bir bakıyor; bu uç yalnız bekleme süresini
   * kısaltıyor. `failed` bir alan adı burada `pending`e döner ve sayaç sıfırlanır.
   */
  async verify(domainId: string, lookup: DnsLookup = systemResolver()): Promise<DomainDto> {
    const domain = await this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      const row = await repo.findDomain(tx, site.id, domainId);
      if (row === undefined) throw AppError.notFound('Alan adı bulunamadı');
      return row;
    });

    if (domain.kind === 'platform_subdomain') return this.present(domain);

    const result = await checkDomainOwnership(lookup, {
      host: domain.host,
      token: domain.verificationToken,
      dnsTarget: domain.dnsTarget,
    });

    const updated = await this.tx.run((tx) =>
      applyCheckResult(tx, domain, result, this.maxAttempts),
    );
    return this.present(updated ?? domain);
  }

  /** Kanonik adresi değiştirir. Yalnız doğrulanmış alan adı birincil olabilir. */
  async setPrimary(domainId: string): Promise<DomainDto> {
    const row = await this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      const domain = await repo.findDomain(tx, site.id, domainId);
      if (domain === undefined) throw AppError.notFound('Alan adı bulunamadı');
      if (domain.verificationStatus !== 'active') {
        throw new AppError(
          409,
          ERROR_CODES.DOMAIN_VERIFICATION_FAILED,
          'Alan adı henüz yayında değil',
          { detail: 'Kanonik adres yalnız doğrulanmış ve sertifikası alınmış bir adres olabilir.' },
        );
      }

      await repo.clearPrimary(tx, site.id);
      return repo.updateDomain(tx, domainId, { isPrimary: true });
    });
    if (row === undefined) throw AppError.notFound('Alan adı bulunamadı');
    return this.present(row);
  }

  get maxAttempts(): number {
    return this.config.get('BOOKING_DOMAIN_MAX_CHECK_ATTEMPTS', { infer: true });
  }

  /**
   * Özel alan adının göstereceği CNAME hedefi.
   *
   * Ayrı bir kenar adresi tanımlanmadıysa kiracının kendi platform subdomain'i
   * kullanılır: tek kurulumlu bir ortamda ikinci bir DNS kaydı yönetmeye gerek
   * kalmıyor ve hedef her zaman gerçekten çözülebilir bir ad oluyor.
   */
  private dnsTargetFor(slug: string): string {
    const configured = this.config.get('BOOKING_DNS_TARGET', { infer: true });
    if (configured !== undefined && configured !== '') return configured;
    return `${slug}.${this.config.get('PUBLIC_BOOKING_DOMAIN', { infer: true })}`;
  }

  private present(row: repo.BookingSiteDomainRow): DomainDto {
    return {
      id: row.id,
      host: row.host,
      kind: row.kind,
      verificationStatus: row.verificationStatus,
      isPrimary: row.isPrimary,
      failureReason: row.failureReason,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      dnsInstructions: dnsInstructions(row),
    };
  }
}

/**
 * DNS talimatları yalnız DOĞRULANMAMIŞ özel alan adlarında dolu.
 *
 * Doğrulanmış bir alan adında talimat göstermek, kullanıcıyı çalışan bir
 * kurulumu değiştirmeye davet ederdi.
 */
function dnsInstructions(row: repo.BookingSiteDomainRow): DnsInstructionsDto | null {
  if (row.kind !== 'custom') return null;
  if (row.verificationStatus === 'active') return null;
  return {
    txtName: `${VERIFY_TXT_PREFIX}.${row.host}`,
    txtValue: row.verificationToken,
    cnameName: row.host,
    cnameValue: row.dnsTarget,
  };
}

/**
 * DNS kontrolünün sonucunu satıra işler.
 *
 * Süpürücü worker'ı ve elle doğrulama ucu AYNI fonksiyonu çağırır: durum
 * makinesinin iki kopyası olsaydı, biri `failed`e geçerken diğeri geçmezdi.
 */
export async function applyCheckResult(
  tx: Tx,
  domain: repo.BookingSiteDomainRow,
  result: { verified: boolean; reason?: string },
  maxAttempts: number,
): Promise<repo.BookingSiteDomainRow | undefined> {
  const now = new Date();

  if (result.verified) {
    // `active`e DEĞİL `dns_verified`e geçiyoruz. Aktifleşme kenar proxy'sinin
    // gerçek sertifika isteğinde olur; buradaki sorgu kendi ağımızdan yapıldı
    // ve tek başına "trafik bize ulaşıyor" demek değil.
    return repo.updateDomain(tx, domain.id, {
      verificationStatus: domain.verificationStatus === 'active' ? 'active' : 'dns_verified',
      checkAttempts: 0,
      lastCheckedAt: now,
      verifiedAt: domain.verifiedAt ?? now,
      failureReason: null,
    });
  }

  const attempts = domain.checkAttempts + 1;
  return repo.updateDomain(tx, domain.id, {
    verificationStatus: attempts >= maxAttempts ? 'failed' : domain.verificationStatus,
    checkAttempts: attempts,
    lastCheckedAt: now,
    failureReason: result.reason ?? 'DNS kaydı doğrulanamadı.',
  });
}
