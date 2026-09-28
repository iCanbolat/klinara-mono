import { sql } from 'drizzle-orm';
import type {
  AppointmentConsentStatus,
  ConsentRequirementItem,
  SignableConsentDocument,
} from '@klinara/shared';
import type { Tx } from '../../database/tenant-tx';

/**
 * Bir randevu için hangi onamların gerektiği ve hangilerinin karşılandığı.
 *
 * DI'sız, `tx` alan saf fonksiyonlar: randevu durum geçişi (`BookingModule`)
 * ve imza modu (`ConsentModule`) AYNI hesabı kullanmak zorunda. İki kopya
 * olsaydı, imza modu "tamam" derken durum geçişi "eksik" diyebilirdi.
 *
 * Kurallar:
 *   * KVKK: yayında bir KVKK metni varsa, hastanın HERHANGİ bir sürüm için
 *     online kabulü ya da klinik imzası yeterli. Sürüm değişince yeniden
 *     onam istenmez (v1 kararı).
 *   * İşlem onamı: randevudaki hizmetlere bağlı, arşivlenmemiş ve yayında
 *     sürümü olan her şablon. `validity_days` null ise bu randevuya bağlı
 *     bir imza; N ise son N gün içinde bu hastanın herhangi bir imzası.
 */

export interface RequirementSubject {
  appointmentId: string | null;
  customerId: string;
  /** Randevudaki sırasıyla; işlem onamları bu sırada istenir. */
  serviceIds: string[];
}

interface KvkkDocument {
  id: string;
  version: number;
  body: string | null;
  sha256: string;
}

interface TemplateRequirement {
  templateId: string;
  name: string;
  validityDays: number | null;
  versionId: string;
  version: number;
  body: string | null;
  sha256: string;
}

interface TreatmentSignature {
  id: string;
  customerId: string;
  templateId: string;
  appointmentId: string | null;
  signedAt: Date;
}

export interface ConsentContext {
  kvkk: KvkkDocument | undefined;
  /** Müşteri → KVKK'yı karşılayan klinik imzası (online kabulde `null`). */
  kvkkByCustomer: Map<string, string | null>;
  templatesByService: Map<string, TemplateRequirement[]>;
  treatmentSignatures: TreatmentSignature[];
}

/**
 * Birden çok randevunun ihtiyacını TEK seferde yükler.
 *
 * Takvim görünümü yüzlerce randevuyu rozetlerken randevu başına sorgu
 * atmasın diye her şey `any(...)` ile toplu çekiliyor. `includeBodies`
 * kapalıysa 20k'lık metinler taşınmaz — rozet için gerekmez.
 */
export async function loadConsentContext(
  tx: Tx,
  subjects: RequirementSubject[],
  options: { includeBodies: boolean },
): Promise<ConsentContext> {
  const customerIds = unique(subjects.map((subject) => subject.customerId));
  const serviceIds = unique(subjects.flatMap((subject) => subject.serviceIds));

  const kvkk = await findActiveKvkk(tx, options.includeBodies);
  const kvkkByCustomer =
    kvkk === undefined || customerIds.length === 0
      ? new Map<string, string | null>()
      : await findKvkkEvidence(tx, customerIds);

  const templatesByService =
    serviceIds.length === 0
      ? new Map<string, TemplateRequirement[]>()
      : await findTemplatesForServices(tx, serviceIds, options.includeBodies);

  const templateIds = unique(
    [...templatesByService.values()].flat().map((template) => template.templateId),
  );
  const treatmentSignatures =
    templateIds.length === 0 || customerIds.length === 0
      ? []
      : await findTreatmentSignatures(tx, customerIds, templateIds);

  return { kvkk, kvkkByCustomer, templatesByService, treatmentSignatures };
}

/** Tek randevunun gereksinim listesi: önce KVKK, sonra hizmet sırasıyla işlem onamları. */
export function evaluateRequirements(
  context: ConsentContext,
  subject: RequirementSubject,
  now: Date,
): ConsentRequirementItem[] {
  const items: ConsentRequirementItem[] = [];

  if (context.kvkk !== undefined) {
    const satisfied = context.kvkkByCustomer.has(subject.customerId);
    items.push({
      kind: 'kvkk_explicit',
      templateId: null,
      title: KVKK_TITLE,
      satisfied,
      signatureId: context.kvkkByCustomer.get(subject.customerId) ?? null,
      document: satisfied
        ? null
        : signable('kvkk_explicit', context.kvkk.id, KVKK_TITLE, context.kvkk),
    });
  }

  const seen = new Set<string>();
  for (const serviceId of subject.serviceIds) {
    for (const template of context.templatesByService.get(serviceId) ?? []) {
      if (seen.has(template.templateId)) continue;
      seen.add(template.templateId);

      const signature = findSatisfyingSignature(context, subject, template, now);
      items.push({
        kind: 'treatment',
        templateId: template.templateId,
        title: template.name,
        satisfied: signature !== undefined,
        signatureId: signature?.id ?? null,
        document:
          signature === undefined
            ? signable('treatment', template.versionId, template.name, template)
            : null,
      });
    }
  }

  return items;
}

export function consentStatusOf(items: ConsentRequirementItem[]): AppointmentConsentStatus {
  if (items.length === 0) return 'none';
  return items.every((item) => item.satisfied) ? 'ok' : 'missing';
}

/** Durum geçişi için: bu randevuda eksik onam var mı, varsa hangileri. */
export async function missingConsents(
  tx: Tx,
  subject: RequirementSubject,
  now: Date,
): Promise<ConsentRequirementItem[]> {
  const context = await loadConsentContext(tx, [subject], { includeBodies: false });
  return evaluateRequirements(context, subject, now).filter((item) => !item.satisfied);
}

export const KVKK_TITLE = 'KVKK Aydınlatma Metni ve Açık Rıza';

function findSatisfyingSignature(
  context: ConsentContext,
  subject: RequirementSubject,
  template: TemplateRequirement,
  now: Date,
): TreatmentSignature | undefined {
  const candidates = context.treatmentSignatures.filter(
    (signature) =>
      signature.customerId === subject.customerId && signature.templateId === template.templateId,
  );

  if (template.validityDays === null) {
    // Her randevuda yeniden: randevusuz bir bağlamda (müşteri ekranı) işlem
    // onamı hiç karşılanmış sayılmaz.
    if (subject.appointmentId === null) return undefined;
    return candidates.find((signature) => signature.appointmentId === subject.appointmentId);
  }

  const threshold = now.getTime() - template.validityDays * 86_400_000;
  return candidates.find((signature) => signature.signedAt.getTime() >= threshold);
}

function signable(
  kind: SignableConsentDocument['kind'],
  documentId: string,
  title: string,
  source: { version: number; body: string | null; sha256: string },
): SignableConsentDocument {
  return {
    kind,
    documentId,
    title,
    version: source.version,
    body: source.body ?? '',
    sha256: source.sha256,
  };
}

// ---------------------------------------------------------------------------
// Sorgular
// ---------------------------------------------------------------------------

async function findActiveKvkk(tx: Tx, includeBody: boolean): Promise<KvkkDocument | undefined> {
  // Kiracı başına tek site (`booking_sites.tenant_id` UNIQUE); RLS kiracıyı
  // zaten daraltıyor.
  const result = await tx.execute<{
    id: string;
    version: number;
    body: string | null;
    sha256: string;
  }>(sql`
    select d.id, d.version, ${includeBody ? sql`d.body` : sql`null::text`} as body, d.sha256
      from booking_sites bs
      join booking_site_settings s on s.booking_site_id = bs.id
      join consent_documents d on d.id = s.active_consent_document_id
     limit 1
  `);
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return { id: row.id, version: Number(row.version), body: row.body, sha256: row.sha256 };
}

async function findKvkkEvidence(
  tx: Tx,
  customerIds: string[],
): Promise<Map<string, string | null>> {
  // Klinik imzası online kabulden ÖNCE gelir: imza modu ve müşteri ekranı
  // gösterilecek bir kayıt (PDF) arıyor.
  const result = await tx.execute<{ customer_id: string; signature_id: string | null }>(sql`
    select customer_id, max(signature_id::text)::uuid as signature_id
      from (
        select c.customer_id, c.id as signature_id
          from consent_signatures c
         where c.kind = 'kvkk_explicit'
           and c.customer_id = any(${pgUuidArray(customerIds)})
        union all
        select a.customer_id, null::uuid
          from booking_consent_acceptances a
         where a.kind = 'kvkk_explicit'
           and a.customer_id = any(${pgUuidArray(customerIds)})
      ) evidence
     group by customer_id
  `);
  return new Map(result.rows.map((row) => [row.customer_id, row.signature_id]));
}

async function findTemplatesForServices(
  tx: Tx,
  serviceIds: string[],
  includeBody: boolean,
): Promise<Map<string, TemplateRequirement[]>> {
  const result = await tx.execute<{
    service_id: string;
    template_id: string;
    name: string;
    validity_days: number | null;
    version_id: string;
    version: number;
    body: string | null;
    sha256: string;
  }>(sql`
    select sct.service_id, t.id as template_id, t.name, t.validity_days,
           v.id as version_id, v.version,
           ${includeBody ? sql`v.body` : sql`null::text`} as body, v.sha256
      from service_consent_templates sct
      join consent_templates t on t.id = sct.template_id
      join consent_template_versions v on v.id = t.active_version_id
     where sct.service_id = any(${pgUuidArray(serviceIds)})
       and t.archived_at is null
     order by t.name, t.id
  `);

  const map = new Map<string, TemplateRequirement[]>();
  for (const row of result.rows) {
    const list = map.get(row.service_id) ?? [];
    list.push({
      templateId: row.template_id,
      name: row.name,
      validityDays: row.validity_days === null ? null : Number(row.validity_days),
      versionId: row.version_id,
      version: Number(row.version),
      body: row.body,
      sha256: row.sha256,
    });
    map.set(row.service_id, list);
  }
  return map;
}

async function findTreatmentSignatures(
  tx: Tx,
  customerIds: string[],
  templateIds: string[],
): Promise<TreatmentSignature[]> {
  const result = await tx.execute<{
    id: string;
    customer_id: string;
    template_id: string;
    appointment_id: string | null;
    signed_at: string | Date;
  }>(sql`
    select id, customer_id, template_id, appointment_id, signed_at
      from consent_signatures
     where kind = 'treatment'
       and customer_id = any(${pgUuidArray(customerIds)})
       and template_id = any(${pgUuidArray(templateIds)})
     order by signed_at desc
  `);
  return result.rows.map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    templateId: row.template_id,
    appointmentId: row.appointment_id,
    signedAt: new Date(row.signed_at),
  }));
}

/** Mevcut idiyom (bkz. `report-scope.ts`): virgüllü metin → `uuid[]`. */
function pgUuidArray(values: string[]) {
  return sql`string_to_array(${values.join(',')}, ',')::uuid[]`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
