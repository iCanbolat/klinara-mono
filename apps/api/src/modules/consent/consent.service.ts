import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { RequestContextService } from '../../common/request-context';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { BookingSiteProvisioner } from '../booking-page/booking-site.provisioner';
import * as pageRepo from '../booking-page/booking-page.repository';
import { consentHash } from '../public/consent-hash';
import * as repo from './consent.repository';
import type {
  ConsentAcceptanceDto,
  ConsentDocumentDto,
  ConsentDocumentStateDto,
  ConsentDocumentSummaryDto,
  UpdateConsentDraftDto,
} from './dto/consent.dto';

const VERSION_HISTORY_LIMIT = 50;
const ACCEPTANCE_LIMIT = 100;

/**
 * KVKK/aydınlatma onam metni ve kabul kanıtı.
 *
 * Faz 7 TEK zorunlu onaya daraltıldı, bu yüzden ortada bir "şablon motoru"
 * yok: site başına tek belge, sürümlü. Yayın modeli `booking_page`in aynısı —
 * yayın bir pointer taşımaktır (`booking_site_settings.activeConsentDocumentId`),
 * yayınlanmış gövde ise DEĞİŞMEZ (trigger zorlar). "Yayındaki metni düzelttim"
 * diye bir işlem yok; yeni sürüm var. Aksi hâlde "müşteri hangi metni
 * onayladı" sorusu yıllar sonra cevaplanamazdı.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly requestContext: RequestContextService,
    private readonly provisioner: BookingSiteProvisioner,
  ) {}

  async getState(): Promise<ConsentDocumentStateDto> {
    return this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      return {
        active: present(await this.loadActive(tx, site.id)),
        draft: present(await repo.findDraft(tx, site.id)),
      };
    });
  }

  /**
   * Taslağı yazar. Site başına en fazla bir taslak var (kısmî UNIQUE),
   * bu yüzden ikinci yazım aynı satırı günceller.
   *
   * `sha256` burada, SUNUCUDA hesaplanıyor — istemcinin beyanı asla kanıt
   * zincirine girmiyor.
   */
  async saveDraft(input: UpdateConsentDraftDto): Promise<ConsentDocumentStateDto> {
    await this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      const body = input.body.trim();
      if (body.length === 0) {
        throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Onam metni boş olamaz');
      }
      const values = { body, sha256: consentHash(body), locale: input.locale ?? 'tr' };

      const draft = await repo.findDraft(tx, site.id);
      if (draft === undefined) {
        await repo.insertDraft(tx, {
          tenantId: this.tx.tenantId,
          bookingSiteId: site.id,
          ...values,
        });
      } else {
        await repo.updateDraft(tx, draft.id, values);
      }
    });
    return this.getState();
  }

  /**
   * Taslağı yeni sürüm olarak yayınlar.
   *
   * GERİ ALINAMAZ: yayınlanan gövde bir daha değişmez. Öncekini silmiyoruz,
   * arşive alıyoruz — eski kabul kanıtları o sürüme bağlı ve bir kanıtın
   * dayanağı ortadan kaldırılamaz.
   */
  async publish(): Promise<ConsentDocumentStateDto> {
    await this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      // Site satırını kilitliyoruz: sürüm numarası üretimi ile pointer taşıma
      // arasında ikinci bir yayın araya girerse `(site, kind, version)` UNIQUE
      // 23505'e düşerdi (doğru sonuç, anlamsız hata).
      await pageRepo.lockSite(tx, site.id);

      const draft = await repo.findDraft(tx, site.id);
      if (draft === undefined) {
        throw new AppError(409, ERROR_CODES.VALIDATION_FAILED, 'Yayınlanacak taslak yok', {
          detail: 'Önce onam metnini kaydedin.',
        });
      }

      const previous = await this.loadActive(tx, site.id);
      const published = await repo.publishDraft(tx, draft.id, {
        version: await repo.nextVersion(tx, site.id),
        publishedBy: this.requestContext.get()?.userId ?? null,
      });
      if (published === undefined) throw new Error('Onam metni yayınlanamadı');

      await pageRepo.updateSettings(tx, site.id, { activeConsentDocumentId: published.id });
      if (previous !== undefined) await repo.archive(tx, previous.id);
    });
    return this.getState();
  }

  async listVersions(): Promise<ConsentDocumentSummaryDto[]> {
    return this.tx.run(async (tx) => {
      const site = await this.provisioner.ensure(tx);
      const rows = await repo.listVersions(tx, site.id, VERSION_HISTORY_LIMIT);
      // Taslağın sürümü yok; sürüm GEÇMİŞİ yalnız yayınlanmışları anlatır.
      // Gövde listeye BİNMİYOR: 20k'lık metinleri sürüm başına taşımanın
      // ekrana kattığı hiçbir şey yok.
      return rows
        .filter((row) => row.status !== 'draft')
        .map((row) => ({
          id: row.id,
          kind: row.kind,
          version: row.version,
          locale: row.locale,
          sha256: row.sha256,
          status: row.status,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }));
    });
  }

  /**
   * Kabul kanıtı listesi.
   *
   * Gösterilen metnin birebir kopyası burada dönüyor: yayındaki metin yarın
   * yeni bir sürüme geçse bile "bu müşteriye ne gösterildi" cevaplanabilir.
   */
  async listAcceptances(filter: {
    customerId?: string;
    appointmentId?: string;
  }): Promise<ConsentAcceptanceDto[]> {
    if (filter.customerId === undefined && filter.appointmentId === undefined) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Filtre gerekli', {
        detail: '`customerId` veya `appointmentId` verilmeli.',
      });
    }
    return this.tx.run(async (tx) => {
      const rows = await repo.listAcceptances(tx, filter, ACCEPTANCE_LIMIT);
      return rows.map((row) => ({
        id: row.id,
        appointmentId: row.appointmentId,
        customerId: row.customerId,
        kind: row.kind,
        version: row.consentVersion,
        locale: row.locale,
        text: row.textBody,
        textSha256: row.textSha256,
        acceptedAt: row.acceptedAt.toISOString(),
        ip: row.ip,
        userAgent: row.userAgent,
      }));
    });
  }

  private async loadActive(
    tx: Tx,
    siteId: string,
  ): Promise<repo.ConsentDocumentRow | undefined> {
    const settings = await pageRepo.findSettings(tx, siteId);
    if (settings?.activeConsentDocumentId == null) return undefined;
    return repo.findById(tx, settings.activeConsentDocumentId);
  }
}

function present(row: repo.ConsentDocumentRow | undefined): ConsentDocumentDto | null {
  if (row === undefined) return null;
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    locale: row.locale,
    body: row.body,
    sha256: row.sha256,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
