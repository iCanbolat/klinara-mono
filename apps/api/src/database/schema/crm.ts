import { citext } from './columns';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { tenants } from './tenancy';

/** Müşteri cinsiyeti — KVKK açısından zorunlu değil, bu yüzden `undisclosed` var. */
export type CustomerGender = 'female' | 'male' | 'other' | 'undisclosed';

/** Müşterinin kliniğe nereden geldiği — pazarlama harcamasının karşılığı burada okunur. */
export type CustomerSource =
  | 'walk_in'
  | 'referral'
  | 'instagram'
  | 'google'
  | 'website'
  | 'whatsapp'
  | 'other';

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    /** E.164, kiracı içinde tekil (kısmi indeks). */
    phone: text('phone'),
    email: citext('email'),
    birthDate: date('birth_date', { mode: 'string' }),
    gender: text('gender').$type<CustomerGender>(),
    notes: text('notes'),
    addressLine: text('address_line'),
    district: text('district'),
    city: text('city'),
    postalCode: text('postal_code'),
    source: text('source').$type<CustomerSource>(),
    /** Birleştirilen kayıt arşivlenir ve hayatta kalana işaret eder. */
    mergedIntoCustomerId: uuid('merged_into_customer_id'),
    /**
     * Ad + telefon, Türkçe duyarlı katlanmış hâlde. Veritabanı üretir
     * (`generated always as … stored`); uygulama ASLA yazmaz.
     */
    searchText: text('search_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('customers_tenant_phone_key').on(table.tenantId, table.phone)],
);

export const customerTags = pgTable(
  'customer_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** `#RRGGBB` — takvim ve liste rozetlerinde kullanılır. */
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Tekillik KATLANMIŞ ada göredir ("VIP" = "Vip" = "vıp"); ifade indeksi
  // olduğu için tanım SQL migration'ında durur.
  () => [],
);

export const customerTagAssignments = pgTable(
  'customer_tag_assignments',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => customerTags.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.customerId, table.tagId] }),
    index('customer_tag_assignments_tag_idx').on(table.tagId),
  ],
);

/** Birleştirme kaydı — append-only, trigger ile değişmez. */
export const customerMerges = pgTable('customer_merges', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  sourceCustomerId: uuid('source_customer_id')
    .notNull()
    .references(() => customers.id),
  targetCustomerId: uuid('target_customer_id')
    .notNull()
    .references(() => customers.id),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  /** Tablo → taşınan satır sayısı. */
  moved: jsonb('moved').$type<Record<string, number>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Not türü — görünürlük kuralı buradan çözülür (bkz. `NotesService`). */
export type CustomerNoteKind = 'general' | 'treatment' | 'internal';

export const customerNotes = pgTable(
  'customer_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id'),
    kind: text('kind').$type<CustomerNoteKind>().notNull().default('general'),
    body: text('body').notNull(),
    customerVisible: boolean('customer_visible').notNull().default(false),
    authorUserId: uuid('author_user_id').references(() => users.id),
    /** Trigger artırır; uygulama yazmaz. */
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('customer_notes_customer_idx').on(table.customerId, table.createdAt)],
);

/** Düzenlemeden ÖNCEKİ metin — trigger yazar, append-only. */
export const customerNoteRevisions = pgTable('customer_note_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  noteId: uuid('note_id')
    .notNull()
    .references(() => customerNotes.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  version: integer('version').notNull(),
  editedBy: uuid('edited_by').references(() => users.id),
  editedAt: timestamp('edited_at', { withTimezone: true }).notNull().defaultNow(),
});
