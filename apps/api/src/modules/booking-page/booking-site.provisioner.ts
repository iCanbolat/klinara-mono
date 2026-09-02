import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/app-error';
import { platformHost } from '../../common/host';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import * as domainRepo from './domains.repository';
import * as repo from './booking-page.repository';
import { newVerificationToken } from './verification-token';

/**
 * Randevu sayfası kaydını TEMBEL açar.
 *
 * Kiracı bootstrap'ına eklenmedi: Faz 9'dan önce kurulmuş kiracıların satırı
 * olmazdı ve ayrı bir veri taşıma migration'ı gerekirdi. Tembel açılış ikisini
 * de çözüyor.
 *
 * Ortak bir sağlayıcıda duruyor çünkü sayfayı İLK dokunan uç açmalı — hangi uç
 * olduğu önemli değil. Ayarlar servisine gömülü kalsaydı, alan adı eklemeyi
 * sayfa ayarlarını bir kez açmış olmaya bağlardık ve bu, kullanıcının
 * göremediği bir sıra kuralı olurdu.
 */
@Injectable()
export class BookingSiteProvisioner {
  constructor(
    private readonly tx: TenantTxService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async ensure(tx: Tx): Promise<repo.BookingSiteRow> {
    const existing = await repo.findSite(tx);
    if (existing !== undefined) return existing;

    const tenantId = this.tx.tenantId;
    const slug = await repo.findTenantSlug(tx, tenantId);
    if (slug === undefined) throw AppError.notFound('Kiracı bulunamadı');

    const site = await repo.insertSite(tx, { tenantId, slug, defaultBranchId: null });
    await repo.insertDefaultSettings(tx, tenantId, site.id);

    // Platform subdomain'i siteyle BİRLİKTE doğar ve doğuştan `active`:
    // kliniğin kanonik adresi bize ait, bir doğrulama sürecine tabi değil.
    const host = platformHost(slug, this.config.get('PUBLIC_BOOKING_DOMAIN', { infer: true }));
    await domainRepo.insertDomain(tx, {
      tenantId,
      bookingSiteId: site.id,
      host,
      kind: 'platform_subdomain',
      verificationStatus: 'active',
      verificationToken: newVerificationToken(),
      dnsTarget: host,
      isPrimary: true,
    });

    return site;
  }
}
