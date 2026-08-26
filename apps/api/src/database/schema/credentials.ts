import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { textArray } from './columns';

/** `bytea` — WebAuthn açık anahtarı. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * TOTP sırrı ŞİFRELİ saklanır (AES-256-GCM).
 *
 * Parolanın aksine hash'lenemez: doğrulama için sırrın kendisi gerekir.
 * Şifreleme anahtarı env/KMS'ten gelir, veritabanında durmaz.
 */
export const userTotpSecrets = pgTable('user_totp_secrets', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretEncrypted: text('secret_encrypted').notNull(),
  keyId: text('key_id').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  /** Replay koruması: aynı adım (30 sn pencere) ikinci kez kabul edilmez. */
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userBackupCodes = pgTable(
  'user_backup_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('user_backup_codes_user_id_code_hash_key').on(table.userId, table.codeHash)],
);

export const phoneVerificationCodes = pgTable(
  'phone_verification_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    /** sha256 — kod düz metin saklanmaz. */
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /** Deneme hakkı dolduğunda kod komple yanar. */
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('phone_verification_codes_user_idx').on(table.userId)],
);

export const userPasskeys = pgTable(
  'user_passkeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** base64url; global tekil. */
    credentialId: text('credential_id').notNull().unique(),
    publicKey: bytea('public_key').notNull(),
    signCount: bigint('sign_count', { mode: 'number' }).notNull().default(0),
    transports: textArray('transports'),
    aaguid: uuid('aaguid'),
    backedUp: boolean('backed_up').notNull().default(false),
    deviceLabel: text('device_label').notNull().default('Cihaz'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('user_passkeys_user_idx').on(table.userId)],
);

export const webauthnPurpose = pgEnum('webauthn_purpose', ['registration', 'authentication']);

export const webauthnChallenges = pgTable('webauthn_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  challenge: text('challenge').notNull().unique(),
  /** Discoverable credential ile girişte kullanıcı henüz bilinmez → `null`. */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  purpose: webauthnPurpose('purpose').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
