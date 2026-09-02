import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { contentETag } from '../../common/http/cache';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import { loadTenantDefaults, resolveSettings } from '../booking-page/booking-page.service';
import * as pageRepo from '../booking-page/booking-page.repository';
import * as repo from './public-content.repository';
import {
  buildAssetIndex,
  collectAssetIds,
  presentBranch,
  presentCatalog,
  resolveAssets,
  type PublicBranchView,
  type PublicCategoryView,
} from './present-public-site';
import type { PublicSiteContext } from './public-site-resolver.service';

export interface PublicSiteView {
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  locales: string[];
  defaultBranchId: string | null;
  branches: PublicBranchView[];
  theme: unknown;
  sections: unknown[];
  seo: unknown;
  settings: PublicBookingSettingsView;
  revision: { number: number; contentHash: string };
}

/**
 * Public tarafa açılan ayarlar — yönetim DTO'sunun ALT KÜMESİ.
 *
 * `contactEmail`, `consentTexts`in tam metni ve `otpChannel` gibi alanların
 * bir kısmı bilerek burada: randevu akışı onlara ihtiyaç duyuyor. Ama
 * `usesTenantDefaults` gibi yönetim ayrıntıları YOK — public sayfanın
 * kliniğin iç yapılandırmasını bilmesi gerekmiyor.
 */
export interface PublicBookingSettingsView {
  minLeadMinutes: number;
  maxAdvanceDays: number;
  cancelWindowHours: number;
  holdTtlMinutes: number;
  showStaffSelection: boolean;
  showPrices: boolean;
  allowReschedule: boolean;
  requireOtp: boolean;
  otpChannel: string;
  requiredConsents: { kind: string; text: string; textSha256: string; required: boolean }[];
}

@Injectable()
export class PublicSiteService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * Yayınlanmış sayfanın tamamı — tek çağrıda render edilebilir.
   *
   * `ETag` içerik hash'inden türüyor: yayın `content_hash`i değiştirir,
   * validator değişir, CDN kendiliğinden yeniden doğrular. Açık bir purge
   * mekanizmasına Faz 9'da ihtiyaç yok.
   */
  async getSite(site: PublicSiteContext): Promise<{ view: PublicSiteView; etag: string }> {
    const payload = await this.tx.run(async (tx) => {
      const published = await repo.findPublishedSite(tx, site.siteId);
      if (published === undefined || published.revisionId === null) return undefined;

      const settingsRow = await pageRepo.findSettings(tx, site.siteId);
      const branches = await repo.listPublicBranches(tx);
      const assetIds = collectAssetIds(published);
      const assets = await repo.findAssetsByIds(tx, assetIds);
      const tenantDefaults = await loadTenantDefaults(tx);
      return { published, settingsRow, branches, assets, tenantDefaults };
    });

    if (payload === undefined) {
      // Politika yayınlanmamış siteyi zaten gizliyor; buraya ancak yayında
      // ama içeriği silinmiş bir site düşebilir.
      throw new AppError(
        404,
        ERROR_CODES.SITE_NOT_PUBLISHED,
        'Randevu sayfası yayında değil',
      );
    }

    const { published, settingsRow, branches, assets, tenantDefaults } = payload;
    const assetBaseUrl = this.config.get('PUBLIC_ASSET_BASE_URL', { infer: true });
    const index = buildAssetIndex(assets, assetBaseUrl);

    const resolved = resolveSettings(settingsRow, tenantDefaults);

    const view: PublicSiteView = {
      slug: site.slug,
      name: published.tenantName,
      timezone: published.timezone,
      currency: published.currency,
      locales: resolved.locales,
      defaultBranchId: published.defaultBranchId,
      branches: branches.map(presentBranch),
      theme: resolveAssets(published.theme, index),
      sections: resolveAssets(published.sections, index) as unknown[],
      seo: resolveAssets(published.seo, index),
      settings: toPublicSettings(resolved),
      revision: {
        number: published.revisionNumber ?? 0,
        contentHash: published.contentHash ?? '',
      },
    };

    return {
      view,
      etag: contentETag(published.revisionNumber ?? 0, published.contentHash ?? ''),
    };
  }

  /** Online randevuya açık katalog, kategoriye göre gruplanmış. */
  async getServices(
    site: PublicSiteContext,
    branchId: string | undefined,
  ): Promise<PublicCategoryView[]> {
    return this.tx.run(async (tx) => {
      const settingsRow = await pageRepo.findSettings(tx, site.siteId);
      const showPrices = settingsRow?.showPrices ?? true;

      const branches = await repo.listPublicBranches(tx);
      const scoped =
        branchId === undefined ? branches : branches.filter((row) => row.id === branchId);
      // Var olmayan ya da pasif bir şube kimliği BOŞ liste değil `404` verir:
      // sessiz boş liste, istemcide "bu şubede hiç hizmet yok" gibi görünürdü.
      if (scoped.length === 0) throw AppError.notFound('Şube bulunamadı');

      const published = await repo.findPublishedSite(tx, site.siteId);
      const services = await repo.listOnlineBookableServices(
        tx,
        scoped.map((row) => row.id),
      );
      return presentCatalog(services, {
        showPrices,
        currency: published?.currency ?? 'TRY',
      });
    });
  }
}

function toPublicSettings(
  resolved: ReturnType<typeof resolveSettings>,
): PublicBookingSettingsView {
  return {
    minLeadMinutes: resolved.minLeadMinutes,
    maxAdvanceDays: resolved.maxAdvanceDays,
    cancelWindowHours: resolved.cancelWindowHours,
    holdTtlMinutes: resolved.holdTtlMinutes,
    showStaffSelection: resolved.showStaffSelection,
    showPrices: resolved.showPrices,
    allowReschedule: resolved.allowReschedule,
    requireOtp: resolved.requireOtp,
    otpChannel: resolved.otpChannel,
    // Metnin HASH'i de dönüyor: istemci randevu oluştururken aynı hash'i geri
    // gönderiyor ve sunucu eşleşmezse reddediyor. Böylece "müşteriye ne
    // gösterildi" sorusu yıllar sonra kanıtlanabilir kalıyor (9.4).
    requiredConsents: resolved.consentTexts.map((consent) => ({
      kind: consent.kind,
      text: consent.text,
      textSha256: consentHash(consent.text),
      required: consent.required ?? true,
    })),
  };
}

/**
 * Onam metninin hash'i.
 *
 * `common/crypto/tokens.ts`teki `sha256` ile aynı algoritma; ayrı durmasının
 * sebebi burada hash'lenen şeyin bir SIR değil, bir BELGE olması — ikisi bir
 * gün farklı normalizasyon isteyebilir (örn. satır sonu birleştirme).
 */
function consentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
