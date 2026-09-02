import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/app-error';
import { RequestContextService } from '../../common/request-context';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { EnvironmentVariables } from '../../config/env.validation';
import * as repo from './public-site.repository';

export interface PublicSiteContext {
  siteId: string;
  tenantId: string;
  slug: string;
  defaultBranchId: string | null;
}

/**
 * `runAsPublicLookup`un TEK ÇAĞIRANI.
 *
 * Kural bir üslup tercihi değil: `app.public_flow` bayrağının etki alanı ancak
 * çağıran sayısı bir kaldığı sürece denetlenebilir. Bir entegrasyon testi
 * kaynak ağacında ikinci bir çağıran olmadığını doğruluyor.
 *
 * Servis yalnız KİRACIYI SEÇER; iş yapmaz. Seçimden sonraki her sorgu
 * `TenantTxService.run()` altında, olağan izolasyon politikalarıyla koşar.
 */
@Injectable()
export class PublicSiteResolverService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly requestContext: RequestContextService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * Slug'ı çözer ve kiracıyı istek bağlamına yazar.
   *
   * Bulunamayan slug ile yayınlanmamış slug AYNI yanıtı alır (`404`).
   * Ayrıştırmak, "hangi klinikler bizim müşterimiz" sorusunu numaralandıran
   * bir orakl yaratırdı.
   */
  async adopt(slug: string): Promise<PublicSiteContext> {
    const site = await this.tx.runAsPublicLookup((tx) => repo.findSiteBySlug(tx, slug));
    if (site === undefined) throw AppError.notFound('Randevu sayfası bulunamadı');

    this.requestContext.adoptPublicTenant(site.tenantId);
    return site;
  }

  /** Konak adı → slug + kanonik adres. Next.js soğuk render'da bir kez çağırır. */
  async resolveHost(host: string): Promise<{ slug: string; canonicalUrl: string } | undefined> {
    const row = await this.tx.runAsPublicLookup((tx) => repo.findByHost(tx, host));
    if (row === undefined) return undefined;
    return { slug: row.slug, canonicalUrl: `https://${row.canonicalHost}` };
  }

  /**
   * Kenar proxy'sinin sertifika öncesi sorusu.
   *
   * `dns_verified` bir satır ilk kez sorulduğunda `active`e terfi eder: Caddy
   * ancak sertifika alacakken sorar ve alma ancak trafik gerçekten bize
   * ulaşıyorsa başarılı olur — kendi ağımızdan yapılan bir DNS sorgusundan
   * daha güçlü kanıt.
   */
  async authorizeEdgeHost(host: string): Promise<boolean> {
    const row = await this.tx.runAsPublicLookup((tx) => repo.findEdgeAuthorization(tx, host));
    if (row === undefined) return false;

    if (row.status === 'dns_verified') {
      const now = new Date();
      await this.tx.runForTenant(row.tenantId, (tx) =>
        tx.execute(
          // Drizzle update'i yerine ham SQL: terfi tek bir koşullu yazım ve
          // `verification_status`ın hâlâ `dns_verified` olduğunu AYNI
          // ifadede kontrol ediyor. İki eş zamanlı Caddy isteği ikinci kez
          // `activated_at` yazamaz.
          repo.promoteToActiveSql(row.id, now),
        ),
      );
    }
    return true;
  }

  /** `{slug}.{PUBLIC_BOOKING_DOMAIN}` — platform subdomain'i. */
  get rootDomain(): string {
    return this.config.get('PUBLIC_BOOKING_DOMAIN', { infer: true });
  }
}
