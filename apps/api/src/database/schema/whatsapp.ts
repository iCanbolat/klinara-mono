import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';

export type WhatsAppAccountStatus = 'unconfigured' | 'active' | 'error';
export type WhatsAppTemplateStatus = 'pending' | 'approved' | 'rejected';

export interface WhatsAppTemplateButton {
  type: string;
  text: string;
}

export const whatsappAccounts = pgTable(
  'whatsapp_accounts',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    wabaId: text('waba_id').notNull(),
    phoneNumberId: text('phone_number_id').notNull(),
    businessPhone: text('business_phone'),
    /** AES-256-GCM; API yanıtında ASLA dönmez, maskeli gösterilir. */
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    /** Webhook imzası (8.3) bu sırla doğrulanır. */
    appSecretEncrypted: text('app_secret_encrypted'),
    apiVersion: text('api_version').notNull().default('v21.0'),
    status: text('status').$type<WhatsAppAccountStatus>().notNull().default('unconfigured'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('whatsapp_accounts_waba_key').on(table.wabaId)],
);

export const whatsappTemplates = pgTable(
  'whatsapp_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    language: text('language').notNull().default('tr'),
    category: text('category'),
    status: text('status').$type<WhatsAppTemplateStatus>().notNull().default('pending'),
    bodyVariableCount: integer('body_variable_count').notNull().default(0),
    buttons: jsonb('buttons').$type<WhatsAppTemplateButton[]>().notNull().default([]),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('whatsapp_templates_key').on(table.tenantId, table.name, table.language)],
);

/** 24 saatlik müşteri hizmetleri penceresi — 8.3 doldurur, 8.2 okur. */
export const whatsappContactWindows = pgTable('whatsapp_contact_windows', {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  phone: text('phone').notNull(),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }).notNull(),
});
