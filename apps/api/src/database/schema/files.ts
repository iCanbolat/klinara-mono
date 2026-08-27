import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { inet } from './columns';
import { services } from './catalog';
import { customers } from './crm';
import { users } from './identity';
import { tenants } from './tenancy';

export type CustomerFileKind = 'photo' | 'document';
export type CustomerFilePosition = 'before' | 'after' | 'other';
export type CustomerFileStatus = 'pending' | 'ready';
export type RecordAccessResource = 'file' | 'note';
export type RecordAccessAction = 'view' | 'download';

export const customerFileGroups = pgTable(
  'customer_file_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    bodyArea: text('body_area'),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('customer_file_groups_customer_idx').on(table.customerId, table.createdAt)],
);

export const customerFiles = pgTable(
  'customer_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => customerFileGroups.id, { onDelete: 'set null' }),
    kind: text('kind').$type<CustomerFileKind>().notNull(),
    position: text('position').$type<CustomerFilePosition>().notNull().default('other'),
    /** Nesne anahtarı — içerik ASLA veritabanında durmaz. */
    storageKey: text('storage_key').notNull(),
    thumbnailKey: text('thumbnail_key'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256'),
    status: text('status').$type<CustomerFileStatus>().notNull().default('ready'),
    takenAt: timestamp('taken_at', { withTimezone: true }),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('customer_files_customer_idx').on(table.customerId, table.createdAt)],
);

/** KVKK m.6 erişim kaydı — append-only, trigger ile değişmez. */
export const customerRecordAccessLog = pgTable('customer_record_access_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  resourceType: text('resource_type').$type<RecordAccessResource>().notNull(),
  resourceId: uuid('resource_id'),
  action: text('action').$type<RecordAccessAction>().notNull(),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
