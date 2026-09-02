import { Injectable } from '@nestjs/common';
import { TenantTxService } from '../../database/tenant-tx.service';
import * as pageRepo from '../booking-page/booking-page.repository';
import * as repo from './public-content.repository';
import { StaffRefService } from './staff-ref.service';
import type { PublicSiteContext } from './public-site-resolver.service';

export interface PublicStaffView {
  /** Opak referans. Personel UUID'si public yanıta ASLA çıkmaz. */
  staffRef: string;
  name: string;
  title: string | null;
  bio: string | null;
}

/**
 * Uygulayıcı seçimi.
 *
 * Faz 9'da yalnız personelin ADI dönüyordu ve müşteri seçim yapamıyordu; bu
 * servis o boşluğu kapatıyor. Seçim `showStaffSelection` ayarına bağlı: kapalı
 * olduğunda liste BOŞ döner — uç 404 vermiyor, çünkü "ayar kapalı" bir hata
 * değil, kliniğin tercihidir ve istemci bu adımı hiç göstermez.
 */
@Injectable()
export class PublicStaffService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly refs: StaffRefService,
  ) {}

  async list(
    site: PublicSiteContext,
    query: { branchId: string; serviceIds: string[] },
  ): Promise<PublicStaffView[]> {
    const rows = await this.loadCandidates(site, query);
    return rows.map((row) => ({
      staffRef: this.refs.refFor(site.tenantId, row.id),
      name: row.name,
      title: row.title,
      bio: row.bio,
    }));
  }

  /**
   * Opak ref → personel kimliği.
   *
   * Aday kümesi ÇAĞRI BAŞINA yeniden hesaplanıyor: bir uygulayıcı arada
   * `is_visible_online`ı kapatmışsa ya da hizmetten çıkarılmışsa eski bir ref
   * artık çözülmemeli. Kümeyi cache'lemek, kaldırılmış bir uygulayıcıya
   * randevu yazılabilmesi demekti.
   */
  async resolveRef(
    site: PublicSiteContext,
    query: { branchId: string; serviceIds: string[] },
    ref: string,
  ): Promise<string> {
    const rows = await this.loadCandidates(site, query);
    return this.refs.resolve(
      site.tenantId,
      ref,
      rows.map((row) => row.id),
    );
  }

  private async loadCandidates(
    site: PublicSiteContext,
    query: { branchId: string; serviceIds: string[] },
  ): Promise<repo.OnlineStaffRow[]> {
    return this.tx.run(async (tx) => {
      const settings = await pageRepo.findSettings(tx, site.siteId);
      if ((settings?.showStaffSelection ?? true) === false) return [];
      return repo.listOnlineBookableStaff(tx, query);
    });
  }
}
