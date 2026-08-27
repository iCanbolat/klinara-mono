import { citext } from './columns';
import { date, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';

/** Müşteri cinsiyeti — KVKK açısından zorunlu değil, bu yüzden `undisclosed` var. */
export type CustomerGender = 'female' | 'male' | 'other' | 'undisclosed';

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('customers_tenant_phone_key').on(table.tenantId, table.phone)],
);
