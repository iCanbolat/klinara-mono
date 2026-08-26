import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { branches, tenants } from './tenancy';
import { citext } from './columns';

/**
 * Kullanıcılar KİRACI-ÜSTÜdür: aynı kişi birden çok klinikte çalışabilir.
 * Kiracıya bağlanma noktası `memberships`tir.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull(),
    /** Davetle açılan hesapta parola belirlenene kadar `null`. */
    passwordHash: text('password_hash'),
    fullName: text('full_name').notNull(),
    locale: text('locale').notNull().default('tr-TR'),
    isActive: boolean('is_active').notNull().default(true),
    tokenVersion: integer('token_version').notNull().default(1),
    /** E.164. Doğrulanana kadar giriş tanımlayıcısı DEĞİLDİR. */
    phone: text('phone'),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('users_email_key').on(table.email)],
);

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  key: text('key').primaryKey(),
  scope: text('scope').notNull(),
  name: text('name').notNull(),
  rank: integer('rank').notNull(),
  isSystem: boolean('is_system').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleKey: text('role_key')
      .notNull()
      .references(() => roles.key, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.roleKey, table.permissionKey] })],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Kiracı kapsamlı roller (owner, accountant) için `null`. */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    roleKey: text('role_key')
      .notNull()
      .references(() => roles.key),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('memberships_user_idx').on(table.userId)],
);

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  branch: one(branches, { fields: [memberships.branchId], references: [branches.id] }),
  role: one(roles, { fields: [memberships.roleKey], references: [roles.key] }),
}));
