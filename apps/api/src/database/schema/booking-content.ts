import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { textArray } from './columns';
import { tenants } from './tenancy';
import { users } from './identity';
import { bookingSites } from './booking-sites';

/** Blok dokümanının şema sürümü — biçim değişikliği tek geçişlik dönüşüm olsun diye. */
export const CONTENT_SCHEMA_VERSION = 1;

/**
 * Değişmez içerik sürümü.
 *
 * Yayın = `booking_sites.published_revision_id` pointer taşıma. "Yayındaki
 * metni düzelttim" diye bir işlem yok; yeni sürüm var. Geri alma da pointer'ı
 * eski sürüme taşımaktan ibaret, yani bedava.
 */
export const bookingPageRevisions = pgTable(
  'booking_page_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingSiteId: uuid('booking_site_id')
      .notNull()
      .references(() => bookingSites.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    schemaVersion: integer('schema_version').notNull().default(CONTENT_SCHEMA_VERSION),
    locale: text('locale').notNull().default('tr'),
    theme: jsonb('theme').notNull().default({}),
    sections: jsonb('sections').notNull().default([]),
    seo: jsonb('seo').notNull().default({}),
    /** Kanonik JSON'un sha256'sı; CDN `ETag`i bundan üretilir. */
    contentHash: text('content_hash').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('booking_page_revisions_site_revision_key').on(
      table.bookingSiteId,
      table.revisionNumber,
    ),
  ],
);

export const bookingOtpChannel = pgEnum('booking_otp_channel', ['whatsapp', 'sms']);

/**
 * Davranış ayarları — JSONB'ye GİRMEZ.
 *
 * Randevu motorunun okuduğu anahtarlar ilişkisel kalır; bir slotun alınabilir
 * olup olmadığına karar vermek için doküman ayrıştırmak, sorgulanamayan bir
 * kural demekti. `*_override` alanları `null` iken kiracı ayarına düşer.
 */
export const bookingSiteSettings = pgTable('booking_site_settings', {
  bookingSiteId: uuid('booking_site_id')
    .primaryKey()
    .references(() => bookingSites.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  minLeadMinutesOverride: integer('min_lead_minutes_override'),
  maxAdvanceDaysOverride: integer('max_advance_days_override'),
  cancelWindowHoursOverride: integer('cancel_window_hours_override'),
  holdTtlMinutes: integer('hold_ttl_minutes').notNull().default(10),
  showStaffSelection: boolean('show_staff_selection').notNull().default(true),
  showPrices: boolean('show_prices').notNull().default(true),
  allowReschedule: boolean('allow_reschedule').notNull().default(true),
  requireOtp: boolean('require_otp').notNull().default(true),
  otpChannel: bookingOtpChannel('otp_channel').notNull().default('whatsapp'),
  consentTexts: jsonb('consent_texts').notNull().default([]),
  locales: textArray('locales').notNull(),
  contactEmail: text('contact_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantAssetPurpose = pgEnum('tenant_asset_purpose', [
  'booking_logo',
  'booking_hero',
  'booking_gallery',
  'service_image',
  'favicon',
  'og_image',
]);

export const tenantAssetStatus = pgEnum('tenant_asset_status', ['pending', 'ready']);

/**
 * Marka ve galeri görselleri.
 *
 * `customer_files` kullanılamaz: `customer_id` NOT NULL, her okuma KVKK
 * erişim kaydı yazar ve teslim kısa TTL'li imzalı URL üzerinden olur.
 * Pazarlama görseli üçünün de tersi — teslimi imzasız ve değişmez.
 */
export const tenantAssets = pgTable(
  'tenant_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    purpose: tenantAssetPurpose('purpose').notNull(),
    /** `public/{tenantId}/{assetId}-{sha8}.{ext}` — hash taşıdığı için değişmez. */
    storageKey: text('storage_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    sha256: text('sha256'),
    altText: text('alt_text'),
    status: tenantAssetStatus('status').notNull().default('pending'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('tenant_assets_tenant_idx').on(table.tenantId, table.purpose)],
);

export type BookingOtpChannel = (typeof bookingOtpChannel.enumValues)[number];
export type TenantAssetPurpose = (typeof tenantAssetPurpose.enumValues)[number];
export type TenantAssetStatus = (typeof tenantAssetStatus.enumValues)[number];
