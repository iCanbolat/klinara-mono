import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { RequestContextService } from '../../common/request-context';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { consentHash } from '../public/consent-hash';
import * as repo from './consent-templates.repository';
import type {
  ConsentTemplateDto,
  ConsentTemplateVersionDto,
  ConsentTemplateVersionSummaryDto,
  CreateConsentTemplateDto,
  ServiceConsentTemplatesDto,
  UpdateConsentTemplateDto,
} from './dto/consent-clinic.dto';

const VERSION_HISTORY_LIMIT = 50;

/**
 * İşlem onamı şablonları.
 *
 * Yayın modeli KVKK metniyle (`ConsentService`) aynı: taslak serbestçe
 * düzenlenir, yayın yeni bir sürüm üretip pointer'ı taşır, yayınlanmış gövde
 * değişmez (trigger zorlar). Şablon SİLİNMEZ, arşivlenir — eski imzalar ona
 * bağlı.
 */
@Injectable()
export class ConsentTemplatesService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly requestContext: RequestContextService,
  ) {}

  async list(): Promise<ConsentTemplateDto[]> {
    return this.tx.run(async (tx) => {
      const templates = await repo.listTemplates(tx);
      return this.presentMany(tx, templates);
    });
  }

  async get(id: string): Promise<ConsentTemplateDto> {
    return this.tx.run(async (tx) => {
      const template = await repo.findTemplate(tx, id);
      if (template === undefined) throw notFound();
      const [presented] = await this.presentMany(tx, [template]);
      if (presented === undefined) throw notFound();
      return presented;
    });
  }

  async create(input: CreateConsentTemplateDto): Promise<ConsentTemplateDto> {
    const id = await this.tx.run(async (tx) => {
      const template = await repo.insertTemplate(tx, {
        tenantId: this.tx.tenantId,
        name: requireText(input.name, 'Şablon adı boş olamaz'),
        validityDays: input.validityDays ?? null,
      });
      const body = input.body?.trim();
      if (body !== undefined && body.length > 0) {
        await repo.insertDraft(tx, {
          tenantId: this.tx.tenantId,
          templateId: template.id,
          body,
          sha256: consentHash(body),
        });
      }
      return template.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateConsentTemplateDto): Promise<ConsentTemplateDto> {
    await this.tx.run(async (tx) => {
      const template = await repo.findTemplate(tx, id);
      if (template === undefined) throw notFound();
      await repo.updateTemplate(tx, id, {
        ...(input.name === undefined
          ? {}
          : { name: requireText(input.name, 'Şablon adı boş olamaz') }),
        ...(input.validityDays === undefined ? {} : { validityDays: input.validityDays }),
      });
    });
    return this.get(id);
  }

  /** Şablon başına tek taslak var; ikinci kayıt aynı satırı günceller. */
  async saveDraft(id: string, rawBody: string): Promise<ConsentTemplateDto> {
    await this.tx.run(async (tx) => {
      const template = await repo.findTemplate(tx, id);
      if (template === undefined) throw notFound();
      if (template.archivedAt !== null) throw archived();

      const body = requireText(rawBody, 'Onam metni boş olamaz');
      const values = { body, sha256: consentHash(body) };
      const draft = await repo.findDraft(tx, id);
      if (draft === undefined) {
        await repo.insertDraft(tx, { tenantId: this.tx.tenantId, templateId: id, ...values });
      } else {
        await repo.updateDraft(tx, draft.id, values);
      }
    });
    return this.get(id);
  }

  /**
   * Taslağı yeni sürüm olarak yayınlar. GERİ ALINAMAZ.
   *
   * Önceki sürüm arşive alınır, silinmez: eski imzalar ona bağlı.
   */
  async publish(id: string): Promise<ConsentTemplateDto> {
    await this.tx.run(async (tx) => {
      const template = await repo.lockTemplate(tx, id);
      if (template === undefined) throw notFound();
      if (template.archivedAt !== null) throw archived();

      const draft = await repo.findDraft(tx, id);
      if (draft === undefined) {
        throw new AppError(409, ERROR_CODES.VALIDATION_FAILED, 'Yayınlanacak taslak yok', {
          detail: 'Önce onam metnini kaydedin.',
        });
      }

      const published = await repo.publishDraft(tx, draft.id, {
        version: await repo.nextVersion(tx, id),
        publishedBy: this.requestContext.get()?.userId ?? null,
      });
      if (published === undefined) throw new Error('Onam şablonu yayınlanamadı');

      await repo.updateTemplate(tx, id, { activeVersionId: published.id });
      if (template.activeVersionId !== null)
        await repo.archiveVersion(tx, template.activeVersionId);
    });
    return this.get(id);
  }

  /**
   * Şablonu arşivler: artık hiçbir randevuda istenmez, düzenlenemez.
   *
   * Hizmet bağlantıları KALIR — arşivden çıkarıldığında (`restore`) klinik
   * bağlantıları yeniden kurmak zorunda kalmasın. Gereksinim hesabı arşivli
   * şablonları zaten atlıyor.
   */
  async archive(id: string): Promise<ConsentTemplateDto> {
    await this.tx.run(async (tx) => {
      const template = await repo.findTemplate(tx, id);
      if (template === undefined) throw notFound();
      if (template.archivedAt === null)
        await repo.updateTemplate(tx, id, { archivedAt: new Date() });
    });
    return this.get(id);
  }

  async restore(id: string): Promise<ConsentTemplateDto> {
    await this.tx.run(async (tx) => {
      const template = await repo.findTemplate(tx, id);
      if (template === undefined) throw notFound();
      if (template.archivedAt !== null) await repo.updateTemplate(tx, id, { archivedAt: null });
    });
    return this.get(id);
  }

  async listVersions(id: string): Promise<ConsentTemplateVersionSummaryDto[]> {
    return this.tx.run(async (tx) => {
      const template = await repo.findTemplate(tx, id);
      if (template === undefined) throw notFound();
      const rows = await repo.listVersions(tx, id, VERSION_HISTORY_LIMIT);
      return rows
        .filter((row) => row.status !== 'draft')
        .map((row) => ({
          id: row.id,
          templateId: row.templateId,
          version: row.version,
          sha256: row.sha256,
          status: row.status,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }));
    });
  }

  // -------------------------------------------------------------------------
  // Hizmet bağlantısı
  // -------------------------------------------------------------------------

  async serviceTemplates(serviceId: string): Promise<ServiceConsentTemplatesDto> {
    return this.tx.run(async (tx) => {
      if ((await repo.findActiveService(tx, serviceId)) === undefined) {
        throw AppError.notFound('Hizmet bulunamadı');
      }
      return { serviceId, templateIds: await repo.listTemplateIdsForService(tx, serviceId) };
    });
  }

  /** Hizmetin gerektirdiği şablon listesini TAMAMEN değiştirir. */
  async setServiceTemplates(
    serviceId: string,
    templateIds: string[],
  ): Promise<ServiceConsentTemplatesDto> {
    const ids = [...new Set(templateIds)];
    return this.tx.run(async (tx) => {
      if ((await repo.findActiveService(tx, serviceId)) === undefined) {
        throw AppError.notFound('Hizmet bulunamadı');
      }
      for (const templateId of ids) {
        const template = await repo.findTemplate(tx, templateId);
        if (template === undefined) {
          throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Onam şablonu bulunamadı', {
            detail: templateId,
          });
        }
        if (template.archivedAt !== null) {
          throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Arşivlenmiş şablon bağlanamaz', {
            detail: template.name,
          });
        }
      }
      await repo.replaceServiceLinks(tx, {
        tenantId: this.tx.tenantId,
        serviceId,
        templateIds: ids,
      });
      return { serviceId, templateIds: ids };
    });
  }

  // -------------------------------------------------------------------------

  private async presentMany(
    tx: Tx,
    templates: repo.ConsentTemplateRow[],
  ): Promise<ConsentTemplateDto[]> {
    const ids = templates.map((template) => template.id);
    const activeIds = templates
      .map((template) => template.activeVersionId)
      .filter((value): value is string => value !== null);
    // Sıralı: aynı transaction bağlantısında paralel sorgu zaten kuyruğa girer.
    const actives = await repo.findVersionsByIds(tx, activeIds);
    const drafts = await repo.listDrafts(tx, ids);
    const links = await repo.listServiceLinks(tx);

    const activeById = new Map(actives.map((row) => [row.id, row]));
    const draftByTemplate = new Map(drafts.map((row) => [row.templateId, row]));

    return templates.map((template) => {
      const active =
        template.activeVersionId === null ? undefined : activeById.get(template.activeVersionId);
      const draft = draftByTemplate.get(template.id);
      return {
        id: template.id,
        name: template.name,
        validityDays: template.validityDays,
        archived: template.archivedAt !== null,
        active: active === undefined ? null : presentVersion(active),
        draft: draft === undefined ? null : presentVersion(draft),
        serviceIds: links
          .filter((link) => link.templateId === template.id)
          .map((link) => link.serviceId),
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      };
    });
  }
}

function presentVersion(row: repo.ConsentTemplateVersionRow): ConsentTemplateVersionDto {
  return {
    id: row.id,
    templateId: row.templateId,
    version: row.version,
    body: row.body,
    sha256: row.sha256,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function requireText(value: string, title: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, title);
  return trimmed;
}

function notFound(): AppError {
  return AppError.notFound('Onam şablonu bulunamadı');
}

function archived(): AppError {
  return new AppError(409, ERROR_CODES.VALIDATION_FAILED, 'Şablon arşivlenmiş', {
    detail: 'Arşivlenmiş bir şablon düzenlenemez ya da yayınlanamaz.',
  });
}
