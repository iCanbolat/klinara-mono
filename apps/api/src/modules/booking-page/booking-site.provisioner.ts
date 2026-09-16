import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { CONTENT_SCHEMA_VERSION } from '@klinara/shared';
import { canonicalJson } from '../../common/canonical-json';
import { sha256 } from '../../common/crypto/tokens';
import { AppError } from '../../common/errors/app-error';
import { platformHost } from '../../common/host';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { OBJECT_STORAGE, type ObjectStorage } from '../../lib/storage/storage.types';
import * as assetsRepo from './assets.repository';
import * as domainRepo from './domains.repository';
import * as repo from './booking-page.repository';
import { newVerificationToken } from './verification-token';
import {
  TEMPLATE_IMAGES,
  buildDefaultTemplate,
  readTemplateImage,
  type TemplateImageIds,
} from './template/default-template';

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
 *
 * HAZIR ŞABLON: sayfa açılırken hiç içeriği yoksa (yeni klinik ya da şablondan
 * önce açılmış ama hiç kaydedilmemiş sayfa) şablon görselleri kiracının kendi
 * kütüphanesine kopyalanır ve şablon TASLAK sürüm olarak yazılır
 * (`template/default-template.ts`). Kiracının kendi görseli olduğu için
 * silinebilir, değiştirilebilir; başka bir kiracının dosyasına bağlı değil.
 */
@Injectable()
export class BookingSiteProvisioner {
  constructor(
    private readonly tx: TenantTxService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly logger: PinoLogger,
  ) {}

  async ensure(tx: Tx): Promise<repo.BookingSiteRow> {
    const existing = await repo.findSite(tx);
    if (existing !== undefined) {
      if (existing.draftRevisionId !== null || existing.publishedRevisionId !== null) return existing;
      return this.applyTemplate(tx, existing);
    }

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

    return this.applyTemplate(tx, site);
  }

  /**
   * İçeriksiz sayfaya şablonu yazar. Site satırı KİLİTLİ okunup yeniden
   * denetleniyor: aynı anda açılan iki istek şablonu iki kez yazmasın.
   */
  private async applyTemplate(tx: Tx, site: repo.BookingSiteRow): Promise<repo.BookingSiteRow> {
    if (!this.config.get('BOOKING_PAGE_TEMPLATE_ENABLED', { infer: true })) return site;

    const locked = (await repo.lockSite(tx, site.id)) ?? site;
    if (locked.draftRevisionId !== null || locked.publishedRevisionId !== null) return locked;

    const tenantId = this.tx.tenantId;
    const images = await this.copyTemplateImages(tx, tenantId);
    const name = (await repo.findTenantName(tx, tenantId)) ?? '';
    const document = buildDefaultTemplate(name, images);

    const revision = await repo.insertRevision(tx, {
      tenantId,
      bookingSiteId: site.id,
      schemaVersion: CONTENT_SCHEMA_VERSION,
      locale: 'tr',
      theme: document.theme,
      sections: document.sections,
      seo: document.seo,
      contentHash: sha256(canonicalJson(document)),
      createdBy: null,
    });
    await repo.updateSite(tx, site.id, { draftRevisionId: revision.id });
    return { ...locked, draftRevisionId: revision.id };
  }

  /**
   * Şablon görsellerini `public/{tenantId}/…` altına kopyalar ve kütüphaneye
   * `ready` olarak kaydeder. Depolama erişilemezse şablon GÖRSELSİZ yazılır:
   * editörü açmak, bir nesne deposu hatasına bağlı olmamalı.
   */
  private async copyTemplateImages(tx: Tx, tenantId: string): Promise<TemplateImageIds> {
    const prefix = this.config.get('S3_PUBLIC_PREFIX', { infer: true });

    // Önce DEPO, sonra veritabanı: depo hatası yakalanıp görselsiz devam
    // edilebilir, ama transaction içindeki bir SQL hatası transaction'ı
    // düşürürdü. Kayıtlar yalnız tüm yüklemeler başarılıysa yazılıyor.
    const uploaded: { image: (typeof TEMPLATE_IMAGES)[number]; assetId: string; storageKey: string; body: Buffer }[] = [];
    try {
      for (const image of TEMPLATE_IMAGES) {
        const body = await readTemplateImage(image);
        const assetId = randomUUID();
        // Anahtar kalıbı `AssetsService.storageKeyFor` ile aynı.
        const fingerprint = createHash('sha256').update(assetId).digest('hex').slice(0, 8);
        const storageKey = `${prefix}/${tenantId}/${assetId}-${fingerprint}.webp`;
        await this.storage.put(storageKey, body, 'image/webp');
        uploaded.push({ image, assetId, storageKey, body });
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Şablon görselleri kopyalanamadı — şablon görselsiz yazılıyor');
      return {};
    }

    const ids: TemplateImageIds = {};
    for (const { image, assetId, storageKey, body } of uploaded) {
      await assetsRepo.insertAsset(tx, {
        id: assetId,
        tenantId,
        purpose: image.purpose,
        storageKey,
        mimeType: 'image/webp',
        sizeBytes: body.length,
        width: image.width,
        height: image.height,
        sha256: createHash('sha256').update(body).digest('hex'),
        altText: image.alt,
        status: 'ready',
        createdBy: null,
      });
      ids[image.key] = assetId;
    }
    return ids;
  }
}
