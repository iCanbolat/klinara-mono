import {
  boolean,
  char,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { customType } from 'drizzle-orm/pg-core';

/** `citext` — büyük/küçük harf duyarsız metin (slug, e-posta). */
const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/**
 * `integer[]` — hatırlatma saatleri gibi küçük sayı listeleri.
 *
 * node-postgres `int4[]` sütunlarını ZATEN JS dizisine çevirir, dolayısıyla
 * `fromDriver` çoğu zaman bir dizi alır. Yine de ham `{24,2}` metni gelme
 * ihtimaline karşı iki biçimi de karşılıyoruz.
 */
const integerArray = customType<{ data: number[]; driverData: string | number[] }>({
  dataType: () => 'integer[]',
  fromDriver: (value) => {
    if (Array.isArray(value)) return value.map(Number);
    return String(value)
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter((part) => part.length > 0)
      .map(Number);
  },
  toDriver: (value) => `{${value.join(',')}}`,
});

export const tenantStatus = pgEnum('tenant_status', ['trial', 'active', 'suspended']);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: citext('slug').notNull().unique(),
  name: text('name').notNull(),
  status: tenantStatus('status').notNull().default('trial'),
  timezone: text('timezone').notNull().default('Europe/Istanbul'),
  currency: char('currency', { length: 3 }).notNull().default('TRY'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: citext('slug').notNull(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Europe/Istanbul'),
    phone: text('phone'),
    address: text('address'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('branches_tenant_slug_key').on(table.tenantId, table.slug)],
);

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  slotGranularityMinutes: integer('slot_granularity_minutes').notNull().default(15),
  preventCustomerDoubleBooking: boolean('prevent_customer_double_booking').notNull().default(true),
  reminderHoursBefore: integerArray('reminder_hours_before').notNull(),
  cancelWindowHours: integer('cancel_window_hours').notNull().default(24),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
