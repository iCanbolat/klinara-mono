import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type ConsentRequirementItem,
  type SignableConsentDocument,
} from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { RequestContextService } from '../../common/request-context';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { OBJECT_STORAGE, type ObjectStorage } from '../../lib/storage/storage.types';
import { AppointmentsService } from '../booking/appointments.service';
import * as crmRepo from '../crm/crm.repository';
import * as filesRepo from '../files/files.repository';
import { canAccessBranch, type Principal } from '../identity/principal';
import {
  consentStatusOf,
  evaluateRequirements,
  loadConsentContext,
  type RequirementSubject,
} from './consent-requirements';
import * as repo from './consent-signatures.repository';
import { renderConsentPdf } from './pdf/consent-pdf';
import { normalizeSignaturePng } from './signature-image';
import type {
  AppointmentConsentStatusDto,
  ConsentPdfUrlDto,
  ConsentRequirementsDto,
  ConsentSignatureDto,
  ConsentSignatureSummaryDto,
  CreateConsentSignatureDto,
} from './dto/consent-clinic.dto';

const CUSTOMER_SIGNATURE_LIMIT = 200;

/** İsteğin izi — kanıta ve erişim kaydına yazılır. */
export interface SignatureRequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

interface SigningTarget {
  subject: RequirementSubject;
  branchId: string | null;
}

/**
 * Klinikte imzalı onam: gereksinim, imza alma, kanıt okuma.
 *
 * İmza kaydı TEK insert ile ve baştan tam yazılır (metin, imza görseli ve
 * PDF'in hash'leri aynı satırda); satır sonradan değişemez (trigger). Bu
 * yüzden PDF satırdan ÖNCE üretilir ve depoya yazılır — "PDF'i sonra bir
 * worker üretir" demek, eksik bir kanıt satırının güncellenmesi demekti.
 */
@Injectable()
export class ConsentSignaturesService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly requestContext: RequestContextService,
    private readonly appointments: AppointmentsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // -------------------------------------------------------------------------
  // Gereksinim
  // -------------------------------------------------------------------------

  async requirementsForAppointment(
    principal: Principal,
    appointmentId: string,
  ): Promise<ConsentRequirementsDto> {
    const target = await this.appointmentTarget(principal, appointmentId);
    return this.requirements(target.subject);
  }

  /** Randevusuz bağlam (müşteri ekranı): yalnız KVKK. */
  async requirementsForCustomer(customerId: string): Promise<ConsentRequirementsDto> {
    return this.requirements({ appointmentId: null, customerId, serviceIds: [] });
  }

  /**
   * Takvim rozetleri için toplu durum.
   *
   * Erişilemeyen şubenin randevusu sessizce ATLANIR (404/403 değil): liste
   * zaten kullanıcının görebildiği randevulardan gelir, burada yalnız
   * kurcalanmış bir id listesine karşı savunma var.
   */
  async statuses(principal: Principal, ids: string[]): Promise<AppointmentConsentStatusDto[]> {
    const uniqueIds = [...new Set(ids)];
    return this.tx.run(async (tx) => {
      const rows = await loadAppointmentSubjects(tx, uniqueIds);
      const visible = rows.filter((row) => canAccessBranch(principal, row.branchId));
      const context = await loadConsentContext(
        tx,
        visible.map((row) => row.subject),
        { includeBodies: false },
      );
      const now = new Date();
      return visible.map((row) => ({
        appointmentId: row.id,
        status: consentStatusOf(evaluateRequirements(context, row.subject, now)),
      }));
    });
  }

  // -------------------------------------------------------------------------
  // İmza
  // -------------------------------------------------------------------------

  async signForAppointment(
    principal: Principal,
    appointmentId: string,
    input: CreateConsentSignatureDto,
    meta: SignatureRequestMeta,
  ): Promise<ConsentSignatureSummaryDto> {
    const target = await this.appointmentTarget(principal, appointmentId);
    return this.sign(principal, target, input, meta);
  }

  /**
   * Randevusuz KVKK imzası — kliniğe randevusuz gelen ya da kaydı yeni
   * açılan hasta için. İşlem onamı randevuya bağlı olduğundan burada YOK.
   */
  async signForCustomer(
    principal: Principal,
    customerId: string,
    input: CreateConsentSignatureDto,
    meta: SignatureRequestMeta,
  ): Promise<ConsentSignatureSummaryDto> {
    if (input.kind !== 'kvkk_explicit') {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'İşlem onamı randevuya bağlıdır', {
        detail: 'İşlem onamını randevu üzerinden alın.',
      });
    }
    await this.tx.run(async (tx) => {
      if ((await crmRepo.findCustomerById(tx, customerId)) === undefined) {
        throw AppError.notFound('Müşteri bulunamadı');
      }
    });
    const branchId = this.requestContext.get()?.branchId ?? null;
    return this.sign(
      principal,
      {
        subject: { appointmentId: null, customerId, serviceIds: [] },
        branchId: branchId !== null && canAccessBranch(principal, branchId) ? branchId : null,
      },
      input,
      meta,
    );
  }

  private async sign(
    principal: Principal,
    target: SigningTarget,
    input: CreateConsentSignatureDto,
    meta: SignatureRequestMeta,
  ): Promise<ConsentSignatureSummaryDto> {
    // Görsel doğrulaması transaction DIŞINDA: bozuk bir istek bağlantı tutmasın.
    const signaturePng = await normalizeSignaturePng(input.signaturePng);
    const signerName = input.signerName.trim();
    const guardianOfName =
      input.signerRelation === 'guardian' ? (input.guardianOfName?.trim() ?? null) : null;
    if (
      input.signerRelation === 'guardian' &&
      (guardianOfName === null || guardianOfName.length < 2)
    ) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Hastanın adı gerekli', {
        detail: 'Veli/vasi imzasında hastanın adı yazılmalı.',
      });
    }

    const prepared = await this.tx.run(async (tx) => {
      const document = await resolveSignable(tx, target.subject, input);
      const header = await repo.findDocumentHeader(tx, target.branchId);
      return { document, header };
    });

    const { document, header } = prepared;
    const id = randomUUID();
    const signedAt = new Date();
    const prefix = `${this.tx.tenantId}/${target.subject.customerId}/consents/${id}`;
    const signatureKey = `${prefix}/signature.png`;
    const pdfKey = `${prefix}/consent.pdf`;
    const signatureSha256 = sha256(signaturePng);
    const textSha256 = document.sha256;

    const pdf = await renderConsentPdf({
      signatureId: id,
      clinicName: header.clinicName,
      branchName: header.branchName,
      kind: document.kind,
      documentTitle: document.title,
      documentVersion: document.version,
      text: document.body,
      textSha256,
      signerName,
      signerRelation: input.signerRelation,
      guardianOfName,
      signaturePng,
      signatureSha256,
      signedAt,
      timeZone: header.timeZone,
      collectedByName: principal.fullName,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

    await this.storage.put(signatureKey, signaturePng, 'image/png');
    await this.storage.put(pdfKey, pdf, 'application/pdf');

    try {
      const row = await this.tx.run(async (tx) => {
        // Yayındaki metin PDF üretilirken değişmiş olabilir: kanıt satırı
        // gösterilen metinle eşleşmeyen bir sürüme bağlanmamalı.
        await resolveSignable(tx, target.subject, input);
        return repo.insertSignature(tx, {
          id,
          tenantId: this.tx.tenantId,
          branchId: target.branchId,
          customerId: target.subject.customerId,
          appointmentId: target.subject.appointmentId,
          kind: document.kind,
          consentDocumentId: document.kind === 'kvkk_explicit' ? document.documentId : null,
          templateId: document.kind === 'treatment' ? document.templateId : null,
          templateVersionId: document.kind === 'treatment' ? document.documentId : null,
          documentTitle: document.title,
          documentVersion: document.version,
          textBody: document.body,
          textSha256,
          signerName,
          signerRelation: input.signerRelation,
          guardianOfName,
          signatureKey,
          signatureSha256,
          pdfKey,
          pdfSha256: sha256(pdf),
          collectedBy: principal.userId,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
          signedAt,
        });
      });
      return presentSummary({ signature: row, collectorName: principal.fullName });
    } catch (error) {
      // Satır yazılamadıysa nesneler sahipsiz kalmasın. En iyi çaba: silme
      // başarısız olursa kanıt BOZULMAZ, yalnız depoda artık kalır.
      await Promise.allSettled([this.storage.delete(signatureKey), this.storage.delete(pdfKey)]);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Okuma
  // -------------------------------------------------------------------------

  async listForCustomer(customerId: string): Promise<ConsentSignatureSummaryDto[]> {
    return this.tx.run(async (tx) => {
      const rows = await repo.listForCustomer(tx, customerId, CUSTOMER_SIGNATURE_LIMIT);
      return rows.map(presentSummary);
    });
  }

  async get(principal: Principal, id: string): Promise<ConsentSignatureDto> {
    const row = await this.tx.run((tx) => repo.findSignature(tx, id));
    if (row === undefined || !this.canSee(principal, row.signature)) {
      throw AppError.notFound('Onam kaydı bulunamadı');
    }
    return {
      ...presentSummary(row),
      text: row.signature.textBody,
      signatureSha256: row.signature.signatureSha256,
      ip: row.signature.ip,
      userAgent: row.signature.userAgent,
    };
  }

  /**
   * PDF için süreli adres. HER çağrı `customer_record_access_log`a düşer
   * (KVKK m.6); kayıt URL'den ÖNCE ve aynı transaction'da yazılır.
   */
  async pdfUrl(
    principal: Principal,
    id: string,
    meta: SignatureRequestMeta,
  ): Promise<ConsentPdfUrlDto> {
    const ttl = this.config.get('S3_PRESIGN_TTL_SECONDS', { infer: true });
    const row = await this.tx.run(async (tx) => {
      const found = await repo.findSignature(tx, id);
      if (found === undefined || found.signature.customerId === null) return undefined;
      if (!this.canSee(principal, found.signature)) return undefined;
      await filesRepo.insertAccessLog(tx, {
        tenantId: this.tx.tenantId,
        customerId: found.signature.customerId,
        actorUserId: principal.userId,
        resourceType: 'consent',
        resourceId: found.signature.id,
        action: 'download',
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        requestId: this.requestContext.get()?.requestId ?? null,
      });
      return found.signature;
    });
    if (row === undefined) throw AppError.notFound('Onam kaydı bulunamadı');

    return {
      url: await this.storage.presignGet(row.pdfKey, ttl),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  // -------------------------------------------------------------------------

  private async requirements(subject: RequirementSubject): Promise<ConsentRequirementsDto> {
    return this.tx.run(async (tx) => {
      const customer = await crmRepo.findAnyCustomerById(tx, subject.customerId);
      if (customer === undefined) throw AppError.notFound('Müşteri bulunamadı');
      const context = await loadConsentContext(tx, [subject], { includeBodies: true });
      const items = evaluateRequirements(context, subject, new Date());
      return {
        appointmentId: subject.appointmentId,
        customerId: subject.customerId,
        customerName: customer.fullName,
        items,
        missingCount: items.filter((item) => !item.satisfied).length,
      };
    });
  }

  /** Randevu erişimi (şube + uygulayıcının kendi randevusu) `AppointmentsService.get` ile. */
  private async appointmentTarget(
    principal: Principal,
    appointmentId: string,
  ): Promise<SigningTarget> {
    const appointment = await this.appointments.get(principal, appointmentId);
    return {
      subject: {
        appointmentId: appointment.id,
        customerId: appointment.customerId,
        serviceIds: appointment.services.map((line) => line.serviceId),
      },
      branchId: appointment.branchId,
    };
  }

  /**
   * Şubeye bağlı imzayı yalnız o şubeye erişen görür. Şubesiz imza
   * (randevusuz KVKK) müşteri kaydının bir parçası; müşteriyi gören görür.
   */
  private canSee(principal: Principal, row: repo.ConsentSignatureRow): boolean {
    return row.branchId === null || canAccessBranch(principal, row.branchId);
  }
}

interface ResolvedDocument extends SignableConsentDocument {
  templateId: string | null;
}

/**
 * İmzalanmak istenen belgeyi gereksinim listesinden çözer.
 *
 * Yalnız EKSİK olan ve şu an yayında olan sürüm imzalanabilir. Metin arada
 * yeniden yayınlandıysa (sürüm id'si ya da hash tutmuyor) `CONSENT_TEXT_CHANGED`:
 * hastaya gösterilen metin ile kaydedilecek metin aynı olmalı.
 */
async function resolveSignable(
  tx: Tx,
  subject: RequirementSubject,
  input: CreateConsentSignatureDto,
): Promise<ResolvedDocument> {
  const context = await loadConsentContext(tx, [subject], { includeBodies: true });
  const items = evaluateRequirements(context, subject, new Date());

  let item: ConsentRequirementItem | undefined;
  if (input.kind === 'kvkk_explicit') {
    item = items.find((candidate) => candidate.kind === 'kvkk_explicit');
    if (item === undefined) {
      throw new AppError(409, ERROR_CODES.CONSENT_REQUIRED, 'Yayında KVKK metni yok', {
        detail: 'Önce Onam sayfasından KVKK metnini yayınlayın.',
      });
    }
  } else {
    const templateId = await repo.findTemplateIdOfVersion(tx, input.documentId);
    item = items.find(
      (candidate) => candidate.kind === 'treatment' && candidate.templateId === templateId,
    );
    if (templateId === undefined || item === undefined) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Bu randevu bu onamı gerektirmiyor');
    }
  }

  if (item.satisfied || item.document === null) {
    throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu onam zaten alınmış', {
      detail: item.title,
    });
  }
  if (item.document.documentId !== input.documentId || item.document.sha256 !== input.textSha256) {
    throw AppError.conflict(ERROR_CODES.CONSENT_TEXT_CHANGED, 'Onam metni güncellenmiş', {
      detail: 'Metin siz imza alırken yeniden yayınlandı. Güncel metni hastaya yeniden gösterin.',
    });
  }

  return { ...item.document, templateId: item.templateId };
}

/** Takvim rozetleri: randevular ve hizmetleri TEK sorguda. */
async function loadAppointmentSubjects(
  tx: Tx,
  ids: string[],
): Promise<Array<{ id: string; branchId: string; subject: RequirementSubject }>> {
  if (ids.length === 0) return [];
  const result = await tx.execute<{
    id: string;
    branch_id: string;
    customer_id: string;
    service_ids: string[] | null;
  }>(sql`
    select a.id, a.branch_id, a.customer_id,
           array_agg(s.service_id order by s.sort_order) filter (where s.service_id is not null)
             as service_ids
      from appointments a
      left join appointment_services s on s.appointment_id = a.id
     where a.id = any(string_to_array(${ids.join(',')}, ',')::uuid[])
       and a.deleted_at is null
     group by a.id
  `);
  return result.rows.map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    subject: {
      appointmentId: row.id,
      customerId: row.customer_id,
      serviceIds: row.service_ids ?? [],
    },
  }));
}

function presentSummary(row: repo.SignatureWithCollector): ConsentSignatureSummaryDto {
  const signature = row.signature;
  return {
    id: signature.id,
    kind: signature.kind,
    documentTitle: signature.documentTitle,
    documentVersion: signature.documentVersion,
    signerName: signature.signerName,
    signerRelation: signature.signerRelation,
    guardianOfName: signature.guardianOfName,
    customerId: signature.customerId,
    appointmentId: signature.appointmentId,
    collectedBy:
      signature.collectedBy === null
        ? null
        : { id: signature.collectedBy, name: row.collectorName ?? '—' },
    signedAt: signature.signedAt.toISOString(),
    textSha256: signature.textSha256,
    pdfSha256: signature.pdfSha256,
  };
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
