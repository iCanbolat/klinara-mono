import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { inet } from './columns';
import { branches, tenants } from './tenancy';
import { users } from './identity';
import { bookingSites } from './booking-sites';
import { customers } from './crm';
import { services } from './catalog';
import { appointments } from './appointments';

export const CONSENT_KIND = 'kvkk_explicit' as const;

export const CONSENT_DOCUMENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ConsentDocumentStatus = (typeof CONSENT_DOCUMENT_STATUSES)[number];

/**
 * Sürümlü KVKK/aydınlatma metni.
 *
 * Sürüm modeli `booking_page_revisions` ile aynı: yayın =
 * `booking_site_settings.active_consent_document_id` pointer'ını taşımak.
 * "Yayındaki metni düzelttim" diye bir işlem yok; yeni sürüm var — aksi hâlde
 * "müşteri hangi metni onayladı" sorusu yıllar sonra cevaplanamazdı.
 *
 * Taslak serbestçe düzenlenebilir; yayınlanmış satırda yalnız
 * `published -> archived` geçişi serbest (trigger zorlar).
 */
export const consentDocuments = pgTable(
  'consent_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingSiteId: uuid('booking_site_id')
      .notNull()
      .references(() => bookingSites.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default(CONSENT_KIND),
    /** Taslakta null; sürüm numarası yayın anında kilit altında üretilir. */
    version: integer('version'),
    locale: text('locale').notNull().default('tr'),
    body: text('body').notNull(),
    /** Sunucu hesaplar; istemcinin beyanı değil. */
    sha256: text('sha256').notNull(),
    status: text('status').$type<ConsentDocumentStatus>().notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('consent_documents_version_key').on(table.bookingSiteId, table.kind, table.version),
    index('consent_documents_site_idx').on(table.tenantId, table.bookingSiteId, table.status),
  ],
);

// ---------------------------------------------------------------------------
// Klinikte imzalı onam (0053)
// ---------------------------------------------------------------------------

export const SIGNATURE_KINDS = ['kvkk_explicit', 'treatment'] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

export const SIGNER_RELATIONS = ['self', 'guardian'] as const;
export type SignerRelation = (typeof SIGNER_RELATIONS)[number];

/**
 * İşlem onamı şablonu — hizmete bağlanır, hasta işlem öncesi klinikte imzalar.
 *
 * Gövde burada değil, `consentTemplateVersions`ta: yayın modeli KVKK metniyle
 * aynı (sürüm + pointer), yayınlanmış gövde değişmez.
 */
export const consentTemplates = pgTable(
  'consent_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Null: her randevuda yeniden imza. N: son N gündeki imza yeterli. */
    validityDays: integer('validity_days'),
    activeVersionId: uuid('active_version_id').references(
      (): AnyPgColumn => consentTemplateVersions.id,
    ),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('consent_templates_tenant_idx').on(table.tenantId, table.archivedAt)],
);

export const consentTemplateVersions = pgTable(
  'consent_template_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references((): AnyPgColumn => consentTemplates.id, { onDelete: 'cascade' }),
    /** Taslakta null; yayın anında kilit altında üretilir. */
    version: integer('version'),
    body: text('body').notNull(),
    sha256: text('sha256').notNull(),
    status: text('status').$type<ConsentDocumentStatus>().notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('consent_template_versions_version_key').on(table.templateId, table.version),
  ],
);

/** Hizmet → gerekli işlem onamları. */
export const serviceConsentTemplates = pgTable(
  'service_consent_templates',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => consentTemplates.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.serviceId, table.templateId] })],
);

/**
 * Klinikte atılan imza — değişmez kanıt (trigger zorlar).
 *
 * Gösterilen metnin birebir kopyası, imza görseli ve üretilen PDF'in hash'i
 * aynı satırda: satır tek insert ile ve baştan TAM yazılır.
 */
export const consentSignatures = pgTable(
  'consent_signatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').$type<SignatureKind>().notNull(),
    consentDocumentId: uuid('consent_document_id').references(() => consentDocuments.id),
    templateId: uuid('template_id').references(() => consentTemplates.id),
    templateVersionId: uuid('template_version_id').references(() => consentTemplateVersions.id),
    documentTitle: text('document_title').notNull(),
    documentVersion: integer('document_version').notNull(),
    textBody: text('text_body').notNull(),
    textSha256: text('text_sha256').notNull(),
    signerName: text('signer_name').notNull(),
    signerRelation: text('signer_relation').$type<SignerRelation>().notNull(),
    guardianOfName: text('guardian_of_name'),
    signatureKey: text('signature_key').notNull(),
    signatureSha256: text('signature_sha256').notNull(),
    pdfKey: text('pdf_key').notNull(),
    pdfSha256: text('pdf_sha256').notNull(),
    collectedBy: uuid('collected_by').references(() => users.id, { onDelete: 'set null' }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('consent_signatures_customer_idx').on(table.tenantId, table.customerId, table.signedAt),
    index('consent_signatures_appointment_idx').on(table.tenantId, table.appointmentId),
  ],
);
