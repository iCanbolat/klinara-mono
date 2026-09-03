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
  /** Kanonik adres — `is_primary` alan adından. Boş olabilir (alan adı yoksa). */
  canonicalUrl: string;
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
      const canonicalHost = await repo.findCanonicalHost(tx, site.siteId);
      return { published, settingsRow, branches, assets, tenantDefaults, canonicalHost };
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

    const view = this.buildView(site.slug, payload);
    return {
      view,
      etag: contentETag(payload.published.revisionNumber ?? 0, payload.published.contentHash ?? ''),
    };
  }

  /**
   * Taslak (ya da belirli bir) revizyonun önizlemesi — YÖNETİM tarafı için.
   *
   * `getSite` ile AYNI sunum boru hattını koşuyor ve bu, ucun bütün gerekçesi:
   * editörün ikinci bir renderer'a sahip olması, "önizlemede güzeldi ama
   * yayında bozuk" sınıfı hataların kaynağıdır. Tek presenter, iki giriş noktası.
   *
   * Yetkilendirme burada YOK — çağıran `BookingPageController` ve orada
   * `booking_page:read` zorunlu. Bu servis public modülünde yaşadığı için
   * kendi başına bir yetki kararı vermiyor; `getSite` de vermiyordu.
   *
   * HİÇ İÇERİK KAYDEDİLMEMİŞSE 404 DEĞİL, BOŞ BİR GÖRÜNÜM döner (`revision
   * .number = 0`). Editörün canlı önizlemesi bu görünümü bir TABAN olarak
   * kullanıyor — şubeler, ayarlar, para birimi, kanonik adres — ve üstüne
   * kullanıcının o an yazdığı dokümanı biniyor. 404 dönseydi yeni bir kiracı
   * ilk kaydetmeye kadar hiçbir şey göremezdi; oysa önizlemenin en çok
   * gerektiği an tam da o an. `revisionId` AÇIKÇA verilmişse kural eskisi gibi:
   * çözülemeyen revizyon 404'tür.
   */
  async getDraftSite(
    slug: string,
    siteId: string,
    revisionId: string | undefined,
  ): Promise<PublicSiteView> {
    const payload = await this.tx.run(async (tx) => {
      const published = await repo.findDraftSite(tx, siteId, revisionId);
      if (published === undefined) return undefined;
      // AÇIKÇA bir revizyon istendi ve çözülemedi: yok, ya da başka bir
      // kiracının. İkisini ayırt etmiyoruz — "var ama senin değil" demek bir
      // bilgi sızıntısıdır.
      if (revisionId !== undefined && published.revisionId === null) return undefined;

      const settingsRow = await pageRepo.findSettings(tx, siteId);
      const branches = await repo.listPublicBranches(tx);
      const assetIds = collectAssetIds(published);
      const assets = await repo.findAssetsByIds(tx, assetIds);
      const tenantDefaults = await loadTenantDefaults(tx);
      const canonicalHost = await repo.findCanonicalHost(tx, siteId);
      return { published, settingsRow, branches, assets, tenantDefaults, canonicalHost };
    });

    if (payload === undefined) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, 'Önizlenecek içerik bulunamadı');
    }

    return this.buildView(slug, payload);
  }

  /** İki giriş noktasının paylaştığı sunum. */
  private buildView(
    slug: string,
    payload: {
      published: repo.PublicSiteRow;
      settingsRow: Awaited<ReturnType<typeof pageRepo.findSettings>>;
      branches: Awaited<ReturnType<typeof repo.listPublicBranches>>;
      assets: Awaited<ReturnType<typeof repo.findAssetsByIds>>;
      tenantDefaults: Awaited<ReturnType<typeof loadTenantDefaults>>;
      canonicalHost: string | undefined;
    },
  ): PublicSiteView {
    const { published, settingsRow, branches, assets, tenantDefaults, canonicalHost } = payload;
    const assetBaseUrl = this.config.get('PUBLIC_ASSET_BASE_URL', { infer: true });
    const index = buildAssetIndex(assets, assetBaseUrl);
    const resolved = resolveSettings(settingsRow, tenantDefaults);

    return {
      slug,
      name: published.tenantName,
      timezone: published.timezone,
      currency: published.currency,
      locales: resolved.locales,
      defaultBranchId: published.defaultBranchId,
      canonicalUrl: canonicalHost === undefined ? '' : `https://${canonicalHost}`,
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
