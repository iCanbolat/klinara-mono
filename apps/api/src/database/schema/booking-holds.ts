import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { inet, uuidArray } from './columns';
import { tenants, branches } from './tenancy';
import { staffProfiles } from './staff';
import { customers } from './crm';
import { appointments } from './appointments';
import { bookingSites } from './booking-sites';
import { consentDocuments } from './consent';

export const slotHoldStatus = pgEnum('slot_hold_status', [
  'active',
  'released',
  'expired',
  'converted',
]);

/**
 * Slot tutma.
 *
 * Çakışma garantisi BURADA DEĞİL, `resource_bookings`ta: tutma oraya
 * `source_type='hold'` olarak yazılır ve randevunun kullandığı aynı GIST
 * EXCLUDE constraint'i tarafından korunur. Bu tablo tutmanın kim, ne zaman,
 * ne kadar süreyle bilgisidir — kilidin kendisi değil.
 */
export const slotHolds = pgTable(
  'slot_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    bookingSiteId: uuid('booking_site_id')
      .notNull()
      .references(() => bookingSites.id, { onDelete: 'cascade' }),
    /** Düz metin saklanmaz — token slotu rehin alma yetkisidir. */
    tokenHash: text('token_hash').notNull().unique(),
    serviceIds: uuidArray('service_ids').notNull(),
    staffProfileId: uuid('staff_profile_id').references(() => staffProfiles.id, {
      onDelete: 'cascade',
    }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: slotHoldStatus('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** OTP sonucu hold'a bağlanır; ortalıkta ikinci bir sır dolaşmaz. */
    otpVerifiedAt: timestamp('otp_verified_at', { withTimezone: true }),
    verifiedPhone: text('verified_phone'),
    clientIp: inet('client_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('slot_holds_site_idx').on(table.bookingSiteId, table.status)],
);

export const bookingOtpChallenges = pgTable(
  'booking_otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingSiteId: uuid('booking_site_id')
      .notNull()
      .references(() => bookingSites.id, { onDelete: 'cascade' }),
    slotHoldId: uuid('slot_hold_id')
      .notNull()
      .references(() => slotHolds.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /** Ardışık hatalı denemede kod KOMPLE yanar; kalan deneme sayılmaz. */
    burnedAt: timestamp('burned_at', { withTimezone: true }),
    clientIp: inet('client_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('booking_otp_challenges_phone_lookup').on(table.tenantId, table.phone)],
);

/**
 * Onam kabul kanıtı — KALICI tablo.
 *
 * 9.4'te Faz 7'ye geçici bir köprü olarak açılmıştı; Faz 7 tek zorunlu KVKK
 * onayına daraltılınca `consent_records` hiç yazılmadı ve kanıtın kalıcı evi
 * burası oldu. Eksik olan tek şey sürümdü: artık `consentDocumentId` /
 * `consentVersion` ile yayınlanmış metne bağlanıyor.
 *
 * Kayıtlar değişmez: sonradan düzeltilebilen bir onam kanıtı, kanıt değildir.
 */
export const bookingConsentAcceptances = pgTable(
  'booking_consent_acceptances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingSiteId: uuid('booking_site_id')
      .notNull()
      .references(() => bookingSites.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    textBody: text('text_body').notNull(),
    textSha256: text('text_sha256').notNull(),
    /** 0043 öncesi satırlarda null; kanıt `textBody`/`textSha256` ile tamdır. */
    consentDocumentId: uuid('consent_document_id').references(() => consentDocuments.id),
    consentVersion: integer('consent_version'),
    locale: text('locale'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('booking_consent_acceptances_appointment_idx').on(table.tenantId, table.appointmentId),
    index('booking_consent_acceptances_customer_idx').on(
      table.tenantId,
      table.customerId,
      table.acceptedAt,
    ),
  ],
);

/** Self-servis bağlantısı — TEK randevuya, süreli ve sayaçlı erişim. */
export const bookingAccessTokens = pgTable(
  'booking_access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    useCount: integer('use_count').notNull().default(0),
    maxUses: integer('max_uses').notNull().default(100),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('booking_access_tokens_appt_idx').on(table.tenantId, table.appointmentId)],
);

export type SlotHoldStatus = (typeof slotHoldStatus.enumValues)[number];
export type SlotHoldRow = typeof slotHolds.$inferSelect;
export type BookingOtpChallengeRow = typeof bookingOtpChallenges.$inferSelect;
export type BookingAccessTokenRow = typeof bookingAccessTokens.$inferSelect;
