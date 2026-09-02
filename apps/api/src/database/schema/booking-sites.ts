import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext } from './columns';
import { branches, tenants } from './tenancy';

export const bookingSiteStatus = pgEnum('booking_site_status', [
  'draft',
  'published',
  'unpublished',
]);

export const bookingDomainKind = pgEnum('booking_domain_kind', ['platform_subdomain', 'custom']);

export const domainVerificationStatus = pgEnum('domain_verification_status', [
  'pending',
  'dns_verified',
  'active',
  'failed',
  'disabled',
]);

/** Rezerve konak adları — `tenants.slug` ve özel alan adı kontrolünün TEK kaynağı. */
export const reservedHostnames = pgTable('reserved_hostnames', {
  name: citext('name').primaryKey(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Kiracı başına TEK randevu sayfası (`tenant_id` unique). */
export const bookingSites = pgTable(
  'booking_sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .unique()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** `tenants.slug`in trigger ile senkron tutulan kopyası. */
    slug: citext('slug').notNull().unique(),
    defaultBranchId: uuid('default_branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    status: bookingSiteStatus('status').notNull().default('draft'),
    /** FK 0036'da eklenir (içerik sürümleri). */
    publishedRevisionId: uuid('published_revision_id'),
    draftRevisionId: uuid('draft_revision_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('booking_sites_tenant_idx').on(table.tenantId)],
);

/**
 * Erişilebilir HER konak adı burada bir satırdır.
 *
 * `{slug}.klinara.app` bir "fallback" değil, `kind='platform_subdomain'` olan
 * bir satırdır — çalışma zamanında dallanacak bir şey yok.
 */
export const bookingSiteDomains = pgTable(
  'booking_site_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingSiteId: uuid('booking_site_id')
      .notNull()
      .references(() => bookingSites.id, { onDelete: 'cascade' }),
    host: citext('host').notNull(),
    kind: bookingDomainKind('kind').notNull(),
    verificationStatus: domainVerificationStatus('verification_status').notNull().default('pending'),
    verificationToken: text('verification_token').notNull(),
    dnsTarget: text('dns_target').notNull(),
    checkAttempts: integer('check_attempts').notNull().default(0),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('booking_site_domains_host_key').on(table.host),
    index('booking_site_domains_site_idx').on(table.bookingSiteId),
  ],
);

export type BookingSiteStatus = (typeof bookingSiteStatus.enumValues)[number];
export type BookingDomainKind = (typeof bookingDomainKind.enumValues)[number];
export type DomainVerificationStatus = (typeof domainVerificationStatus.enumValues)[number];
