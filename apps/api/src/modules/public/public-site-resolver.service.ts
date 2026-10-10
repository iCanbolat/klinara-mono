import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/app-error';
import { directBookingUrl } from '../../common/host';
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
   * Yayınlanmamış site de çözülür: doğrudan randevu bağlantısı sayfa içeriği
   * olmadan çalışıyor. Yayın durumunu İÇERİK ucu (`getSite`) uygular.
   */
  async adopt(slug: string): Promise<PublicSiteContext> {
    const site = await this.tx.runAsPublicLookup((tx) => repo.findSiteBySlug(tx, slug));
    if (site === undefined) throw AppError.notFound('Randevu sayfası bulunamadı');

    this.requestContext.adoptPublicTenant(site.tenantId);
    return site;
  }

  /**
   * Konak adı → slug + kanonik adres. Next.js soğuk render'da bir kez çağırır.
   *
   * Sayfası yayında olmayan bir kliniğin PLATFORM subdomain'inde gösterilecek
   * bir şey yok; `directUrl` web'e "buraya yönlendir" der. Özel alan adı
   * yönlendirilmez — klinik kendi adresini bağladıysa randevu akışı orada açılır.
   */
  async resolveHost(
    host: string,
  ): Promise<{ slug: string; canonicalUrl: string; directUrl: string | null } | undefined> {
    const row = await this.tx.runAsPublicLookup((tx) => repo.findByHost(tx, host));
    if (row === undefined) return undefined;
    if (row.status !== 'published' && row.kind === 'platform_subdomain') {
      const directUrl = directBookingUrl(row.slug, this.rootDomain);
      return { slug: row.slug, canonicalUrl: directUrl, directUrl };
    }
    return { slug: row.slug, canonicalUrl: `https://${row.canonicalHost}`, directUrl: null };
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
