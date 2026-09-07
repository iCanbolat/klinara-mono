import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { users } from './identity';
import { bookingSites } from './booking-sites';

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
