import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { contentETag } from '../../common/http/cache';
import { directBookingUrl } from '../../common/host';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import { loadTenantDefaults, resolveSettings } from '../booking-page/booking-page.service';
import * as pageRepo from '../booking-page/booking-page.repository';
import * as repo from './public-content.repository';
import { findActiveConsent, type ActiveConsentRow } from './public-consent.repository';
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
  /**
   * Sayfa içeriği yayında mı. `false` ise yalnız randevu akışı var: `sections`
   * boş gelir ve web pazarlama sayfası yerine doğrudan akışı gösterir.
   */
  published: boolean;
  /**
   * Kanonik adres — `is_primary` alan adından. Boş olabilir (alan adı yoksa).
   * Sayfa yayında değilse ve özel alan adı yoksa doğrudan randevu bağlantısı.
   */
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
 * `contactEmail`, onam metninin tam gövdesi ve `otpChannel` gibi alanların
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
  /**
   * TEK zorunlu KVKK/aydınlatma onayı.
   *
   * Faz 7 daraltıldı: treatment onamı klinik içi ayrı akışa taşındı, marketing
   * ve photo_usage onamları MVP'den çıktı — bu yüzden dizi değil, tek belge.
   * Yayında metin yoksa `null`; o hâlde site zaten yayınlanamaz.
   */
  consent: {
    documentId: string;
    version: number;
    locale: string;
    text: string;
    textSha256: string;
  } | null;
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
   * SAYFA YAYINDA DEĞİLSE 404 değil, İÇERİKSİZ bir görünüm döner
   * (`published: false`): klinik sayfa hazırlamadan da doğrudan bağlantıyla
   * randevu alabiliyor. Taslak içerik bu yoldan ASLA çıkmaz — bloklar ve SEO
   * boşaltılıyor, yalnız (varsa) son yayınlanan temanın logosu ve renkleri
   * kalıyor. KVKK metni yayında değilse site yine `404`: akış onaysız
   * tamamlanamayacağı için açmanın anlamı yok.
   *
   * `ETag` içerik hash'inden türüyor: yayın `content_hash`i değiştirir,
   * validator değişir, CDN kendiliğinden yeniden doğrular. Açık bir purge
   * mekanizmasına Faz 9'da ihtiyaç yok.
   */
  async getSite(site: PublicSiteContext): Promise<{ view: PublicSiteView; etag: string }> {
    const payload = await this.tx.run(async (tx) => {
      const row = await repo.findPublishedSite(tx, site.siteId);
      if (row === undefined) return undefined;
      const live = row.status === 'published' && row.revisionId !== null;
      const published = live ? row : toContentless(row);

      const settingsRow = await pageRepo.findSettings(tx, site.siteId);
      const branches = await repo.listPublicBranches(tx);
      const assetIds = collectAssetIds(published);
      const assets = await repo.findAssetsByIds(tx, assetIds);
      const tenantDefaults = await loadTenantDefaults(tx);
      const canonicalHost = await repo.findCanonicalHost(tx, site.siteId);
      const consent = await findActiveConsent(tx, site.siteId);
      if (!live && consent === undefined) return undefined;
      return {
        published,
        live,
        settingsRow,
        branches,
        assets,
        tenantDefaults,
        canonicalHost,
        consent,
      };
    });

    if (payload === undefined) {
      throw new AppError(
        404,
        ERROR_CODES.SITE_NOT_PUBLISHED,
        'Randevu sayfası yayında değil',
      );
    }

    const view = this.buildView(site.slug, payload);
    return {
      view,
      // İçeriksiz görünümün sürümü yok; validator onam metninden türüyor ki
      // metin değiştiğinde akışın elindeki kopya bayatlamasın.
      etag: payload.live
        ? contentETag(payload.published.revisionNumber ?? 0, payload.published.contentHash ?? '')
        : contentETag(0, payload.consent?.sha256 ?? ''),
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
      const consent = await findActiveConsent(tx, siteId);
      return {
        published,
        // Önizleme her zaman içeriği çizer; yayın durumu editörün meselesi değil.
        live: true,
        settingsRow,
        branches,
        assets,
        tenantDefaults,
        canonicalHost,
        consent,
      };
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
      live: boolean;
      settingsRow: Awaited<ReturnType<typeof pageRepo.findSettings>>;
      branches: Awaited<ReturnType<typeof repo.listPublicBranches>>;
      assets: Awaited<ReturnType<typeof repo.findAssetsByIds>>;
      tenantDefaults: Awaited<ReturnType<typeof loadTenantDefaults>>;
      canonicalHost: { host: string; kind: string } | undefined;
      consent: ActiveConsentRow | undefined;
    },
  ): PublicSiteView {
    const { published, live, settingsRow, branches, assets, tenantDefaults, canonicalHost, consent } =
      payload;
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
      published: live,
      canonicalUrl: this.canonicalUrl(slug, live, canonicalHost),
      branches: branches.map(presentBranch),
      theme: resolveAssets(published.theme, index),
      sections: resolveAssets(published.sections, index) as unknown[],
      seo: resolveAssets(published.seo, index),
      settings: toPublicSettings(resolved, consent),
      revision: {
        number: published.revisionNumber ?? 0,
        contentHash: published.contentHash ?? '',
      },
    };
  }

  /**
   * Platform subdomain'i yalnız sayfa yayındayken bir şey gösteriyor; yayında
   * değilken kliniğin adresi doğrudan randevu bağlantısıdır. Özel alan adı her
   * iki hâlde de kliniğin kendi adresi.
   */
  private canonicalUrl(
    slug: string,
    live: boolean,
    canonicalHost: { host: string; kind: string } | undefined,
  ): string {
    if (!live && canonicalHost?.kind !== 'custom') {
      return directBookingUrl(slug, this.config.get('PUBLIC_BOOKING_DOMAIN', { infer: true }));
    }
    return canonicalHost === undefined ? '' : `https://${canonicalHost.host}`;
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

/** Yayında olmayan sitenin dışarı verilen hâli: bloklar ve SEO yok, sürüm yok. */
function toContentless(row: repo.PublicSiteRow): repo.PublicSiteRow {
  return {
    ...row,
    // Tema yalnız son YAYINLANAN sürümden gelir (`findPublishedSite`); hiç
    // yayınlanmamış sitede zaten boş ve web varsayılan temaya düşer.
    sections: [],
    seo: {},
    revisionId: null,
    revisionNumber: null,
    contentHash: null,
  };
}

function toPublicSettings(
  resolved: ReturnType<typeof resolveSettings>,
  consent: ActiveConsentRow | undefined,
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
    // Sürüm ve hash de dönüyor: istemci randevu oluştururken ikisini de aynen
    // geri gönderiyor, sunucu eşleşmezse reddediyor. Böylece "müşteriye hangi
    // metnin HANGİ SÜRÜMÜ gösterildi" yıllar sonra kanıtlanabilir kalıyor.
    consent:
      consent === undefined
        ? null
        : {
            documentId: consent.id,
            version: consent.version,
            locale: consent.locale,
            text: consent.body,
            textSha256: consent.sha256,
          },
  };
}
