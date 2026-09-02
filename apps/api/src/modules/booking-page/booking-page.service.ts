import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@klinara/shared';
import { canonicalJson } from '../../common/canonical-json';
import { sha256 } from '../../common/crypto/tokens';
import { AppError } from '../../common/errors/app-error';
import { RequestContextService } from '../../common/request-context';
import { CONTENT_SCHEMA_VERSION } from '../../database/schema';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { BookingSiteProvisioner } from './booking-site.provisioner';
import * as domainRepo from './domains.repository';
import * as repo from './booking-page.repository';
import type {
  BookingPageDto,
  BookingSiteSettingsDto,
  ConsentTextDto,
  UpdateBookingPageDto,
} from './dto/booking-page.dto';
import type {
  BookingPageContentDto,
  RevisionSummaryDto,
  UpdateBookingPageContentDto,
} from './dto/content.dto';

/** Sürüm listesi ucunun döndüğü azami satır. */
const REVISION_HISTORY_LIMIT = 50;

@Injectable()
export class BookingPageService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly requestContext: RequestContextService,
    private readonly provisioner: BookingSiteProvisioner,
  ) {}

  async getPage(): Promise<BookingPageDto> {
    const payload = await this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      return {
        site,
        settings: await repo.findSettings(tx, site.id),
        domains: await domainRepo.listDomains(tx, site.id),
        tenantDefaults: await loadTenantDefaults(tx),
      };
    });
    return this.present(payload);
  }

  async updatePage(input: UpdateBookingPageDto): Promise<BookingPageDto> {
    await this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);

      if (input.defaultBranchId !== undefined) {
        await repo.updateSite(tx, site.id, { defaultBranchId: input.defaultBranchId });
      }

      // `null` GEÇERLİ bir değer ("kiracı ayarına dön") ve `undefined`
      // "dokunma" demek. İkisi aynı sayılsaydı bir override'ı geri almanın
      // yolu olmazdı.
      const patch: Record<string, unknown> = {};
      for (const key of [
        'minLeadMinutesOverride',
        'maxAdvanceDaysOverride',
        'cancelWindowHoursOverride',
        'holdTtlMinutes',
        'showStaffSelection',
        'showPrices',
        'allowReschedule',
        'requireOtp',
        'otpChannel',
        'contactEmail',
      ] as const) {
        if (input[key] !== undefined) patch[key] = input[key];
      }
      if (input.consentTexts !== undefined) {
        patch['consentTexts'] = input.consentTexts.map((consent) => ({
          kind: consent.kind,
          text: consent.text,
          required: consent.required ?? true,
        }));
      }
      if (Object.keys(patch).length > 0) await repo.updateSettings(tx, site.id, patch);
    });

    return this.getPage();
  }

  // --- İçerik ---

  async getContent(): Promise<BookingPageContentDto> {
    return this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      const draft =
        site.draftRevisionId === null ? undefined : await repo.findRevision(tx, site.draftRevisionId);
      const published =
        site.publishedRevisionId === null
          ? undefined
          : await repo.findRevision(tx, site.publishedRevisionId);

      // Düzenlenecek içerik taslaktır; taslak yoksa yayınlanmış sürüm
      // başlangıç noktası olur (editör boş bir sayfayla açılmasın).
      const source = draft ?? published;
      return {
        draft: toRevisionSummary(draft, site.publishedRevisionId),
        published: toRevisionSummary(published, site.publishedRevisionId),
        theme: (source?.theme ?? {}) as Record<string, unknown>,
        sections: (source?.sections ?? []) as unknown[],
        seo: (source?.seo ?? {}) as Record<string, unknown>,
      };
    });
  }

  /**
   * Yeni bir TASLAK sürüm yazar.
   *
   * Mevcut taslağın üzerine yazmıyoruz: sürümler değişmez (`reject_mutation`)
   * ve her kaydetme geri alınabilir bir nokta bırakıyor. Editörün "geri al"ı
   * bu yüzden ayrı bir özellik değil, pointer taşımanın doğal sonucu.
   */
  async saveDraft(input: UpdateBookingPageContentDto): Promise<BookingPageContentDto> {
    const document = {
      theme: input.theme ?? {},
      sections: input.sections,
      seo: input.seo ?? {},
    };
    const contentHash = sha256(canonicalJson(document));

    await this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      const revision = await repo.insertRevision(tx, {
        tenantId: this.tx.tenantId,
        bookingSiteId: site.id,
        schemaVersion: CONTENT_SCHEMA_VERSION,
        locale: 'tr',
        theme: document.theme,
        sections: document.sections,
        seo: document.seo,
        contentHash,
        createdBy: this.requestContext.get()?.userId ?? null,
      });
      await repo.updateSite(tx, site.id, { draftRevisionId: revision.id });
    });

    return this.getContent();
  }

  /** Yayın = pointer taşıma. İçerik kopyalanmaz, sürüm işaret edilir. */
  async publish(): Promise<BookingPageDto> {
    await this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      const target = site.draftRevisionId ?? site.publishedRevisionId;
      if (target === null) {
        throw new AppError(
          409,
          ERROR_CODES.SITE_NOT_PUBLISHED,
          'Yayınlanacak içerik yok',
          { detail: 'Önce sayfa içeriğini kaydedin.' },
        );
      }
      await repo.updateSite(tx, site.id, {
        status: 'published',
        publishedRevisionId: target,
        publishedAt: new Date(),
      });
    });
    return this.getPage();
  }

  async unpublish(): Promise<BookingPageDto> {
    await this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      // `publishedRevisionId` KORUNUYOR: yayından kaldırma bir silme değil,
      // bir görünürlük değişikliği. Yeniden yayınlamak aynı sürüme dönmek.
      await repo.updateSite(tx, site.id, { status: 'unpublished' });
    });
    return this.getPage();
  }

  async rollback(revisionId: string): Promise<BookingPageContentDto> {
    await this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      const revision = await repo.findRevisionOfSite(tx, site.id, revisionId);
      if (revision === undefined) throw AppError.notFound('İçerik sürümü bulunamadı');

      // Geri alma taslağı da taşır: editör açıldığında yayındaki içeriği
      // görsün, "geri aldım ama editörde eski hâli duruyor" durumu olmasın.
      await repo.updateSite(tx, site.id, {
        draftRevisionId: revision.id,
        ...(site.status === 'published'
          ? { publishedRevisionId: revision.id, publishedAt: new Date() }
          : {}),
      });
    });
    return this.getContent();
  }

  async listRevisions(): Promise<RevisionSummaryDto[]> {
    return this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      const rows = await repo.listRevisions(tx, site.id, REVISION_HISTORY_LIMIT);
      return rows.map((row) => summarizeRevision(row, site.publishedRevisionId));
    });
  }

  private present(payload: {
    site: repo.BookingSiteRow;
    settings: repo.BookingSiteSettingsRow | undefined;
    domains: domainRepo.BookingSiteDomainRow[];
    tenantDefaults: TenantDefaults;
  }): BookingPageDto {
    const { site, settings, domains, tenantDefaults } = payload;
    const primary = domains.find((domain) => domain.isPrimary) ?? domains[0];

    return {
      id: site.id,
      slug: site.slug,
      status: site.status,
      defaultBranchId: site.defaultBranchId,
      publishedAt: site.publishedAt?.toISOString() ?? null,
      canonicalUrl: primary === undefined ? '' : `https://${primary.host}`,
      hasUnpublishedChanges:
        site.draftRevisionId !== null && site.draftRevisionId !== site.publishedRevisionId,
      settings: resolveSettings(settings, tenantDefaults),
    };
  }
}

export interface TenantDefaults {
  minLeadMinutes: number;
  maxAdvanceDays: number;
  cancelWindowHours: number;
}

/**
 * Kiracı seviyesindeki varsayılanlar.
 *
 * Public taraf da BUNU çağırır: yönetim ekranının gösterdiği yürürlükteki
 * değer ile randevu motorunun uyguladığı değer aynı fonksiyondan gelmeli.
 * İki ayrı çözümleme, klinik ekranda 2 saat görürken motorun 0 uygulaması
 * demekti.
 */
export async function loadTenantDefaults(tx: Tx): Promise<TenantDefaults> {
  // `tenant_settings` RLS altında zaten tek satır: kiracı başına bir kayıt.
  const result = await tx.execute<Record<string, number>>(sql`
    select min_lead_minutes, max_advance_days, cancel_window_hours
      from tenant_settings limit 1
  `);
  const row = result.rows[0];
  return {
    minLeadMinutes: Number(row?.['min_lead_minutes'] ?? 0),
    maxAdvanceDays: Number(row?.['max_advance_days'] ?? 180),
    cancelWindowHours: Number(row?.['cancel_window_hours'] ?? 24),
  };
}

/**
 * Yürürlükteki ayarlar: site override'ı varsa o, yoksa kiracı ayarı.
 *
 * Çözümleme TEK YERDE yapılıyor. İki kural (yönetim ekranının gösterdiği ve
 * randevu motorunun uyguladığı) ayrı ayrı hesaplansaydı, klinik ekranda 2 saat
 * görürken motor 0 uygulayabilirdi.
 */
export function resolveSettings(
  settings: repo.BookingSiteSettingsRow | undefined,
  defaults: TenantDefaults,
): BookingSiteSettingsDto {
  const usesTenantDefaults =
    settings === undefined ||
    (settings.minLeadMinutesOverride === null &&
      settings.maxAdvanceDaysOverride === null &&
      settings.cancelWindowHoursOverride === null);

  return {
    minLeadMinutes: settings?.minLeadMinutesOverride ?? defaults.minLeadMinutes,
    maxAdvanceDays: settings?.maxAdvanceDaysOverride ?? defaults.maxAdvanceDays,
    cancelWindowHours: settings?.cancelWindowHoursOverride ?? defaults.cancelWindowHours,
    usesTenantDefaults,
    holdTtlMinutes: settings?.holdTtlMinutes ?? 10,
    showStaffSelection: settings?.showStaffSelection ?? true,
    showPrices: settings?.showPrices ?? true,
    allowReschedule: settings?.allowReschedule ?? true,
    requireOtp: settings?.requireOtp ?? true,
    otpChannel: settings?.otpChannel ?? 'whatsapp',
    consentTexts: (settings?.consentTexts ?? []) as ConsentTextDto[],
    locales: settings?.locales ?? ['tr'],
    contactEmail: settings?.contactEmail ?? null,
  };
}

function toRevisionSummary(
  row: repo.BookingPageRevisionRow | undefined,
  publishedRevisionId: string | null,
): RevisionSummaryDto | null {
  return row === undefined ? null : summarizeRevision(row, publishedRevisionId);
}

function summarizeRevision(
  row: repo.BookingPageRevisionRow,
  publishedRevisionId: string | null,
): RevisionSummaryDto {
  return {
    id: row.id,
    revisionNumber: row.revisionNumber,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    isPublished: row.id === publishedRevisionId,
  };
}
