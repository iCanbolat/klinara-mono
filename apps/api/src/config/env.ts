import { z } from 'zod';

/**
 * Ortam değişkenleri — süreç açılışında doğrulanır.
 *
 * Kural: `process.env`e uygulama kodunun herhangi bir yerinden DOĞRUDAN
 * erişilmez. Tek giriş noktası burasıdır; böylece hem tipler güvenlidir hem de
 * eksik yapılandırma üretimde değil, açılışta fark edilir.
 */
const PostgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'postgres:// veya postgresql:// ile başlamalı');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** SIGTERM sonrası in-flight isteklere tanınan süre; sonunda süreç zorla kapanır. */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(10_000),

  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute'),

  /** Virgülle ayrılmış origin listesi. Boşsa tarayıcı kaynaklı çapraz istek kabul edilmez. */
  CORS_ORIGINS: z.string().default(''),

  // --- Veritabanı ---
  /**
   * Uygulama bağlantısı. Bu rol NOBYPASSRLS olmalıdır; kiracı izolasyonunun
   * veritabanı seviyesinde zorlanması buna bağlıdır.
   */
  DATABASE_URL: PostgresUrl,
  /**
   * Migration bağlantısı (tabloların sahibi, RLS'i bypass eder).
   * Yalnız `db:migrate` için gerekir; API süreci bunu kullanmaz.
   */
  DATABASE_MIGRATION_URL: PostgresUrl.optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // --- Gözlemlenebilirlik ---
  SERVICE_NAME: z.string().min(1).default('klinara-api'),
  SERVICE_VERSION: z.string().min(1).default('0.0.0'),
  /** Tanımlıysa OpenTelemetry açılır; boşsa telemetri hiç kurulmaz. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  /** Tanımlıysa Sentry açılır. */
  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  /**
   * `/metrics` ucunu koruyan bearer token. Üretimde ZORUNLU — aksi hâlde
   * iç metrikler herkese açık olur (env doğrulamasında ayrıca kontrol edilir).
   */
  METRICS_TOKEN: z.string().optional(),

  // --- Geçici kimlik köprüsü (Faz 1'de kaldırılacak) ---
  /**
   * Platform yönetimi uçları (`/platform/*`) için bearer token.
   * Faz 1.2'de gerçek JWT kimliğine devredilecek.
   */
  PLATFORM_ADMIN_TOKEN: z.string().optional(),
  /**
   * Açıkken kiracı context'i `X-Tenant-Id` / `X-User-Id` başlıklarından okunur.
   * ÜRETİMDE YASAKTIR — env doğrulaması buna izin vermez.
   */
  AUTH_DEV_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = Readonly<z.infer<typeof EnvSchema>>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Ortam değişkeni doğrulaması başarısız:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(kök)';
      return `${key}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }

  // Şema ile ifade edilemeyen, ortama bağlı kurallar.
  const crossFieldIssues: string[] = [];
  if (result.data.NODE_ENV === 'production') {
    if (result.data.METRICS_TOKEN === undefined || result.data.METRICS_TOKEN.length < 16) {
      crossFieldIssues.push(
        'METRICS_TOKEN: üretimde zorunlu ve en az 16 karakter olmalı (/metrics ucu korunmalı)',
      );
    }
    if (result.data.CORS_ORIGINS.trim() === '') {
      crossFieldIssues.push('CORS_ORIGINS: üretimde açıkça tanımlanmalı');
    }
    if (result.data.AUTH_DEV_MODE) {
      crossFieldIssues.push(
        'AUTH_DEV_MODE: üretimde açık olamaz — kimlik doğrulamasını başlıkla atlatır',
      );
    }
    if (result.data.PLATFORM_ADMIN_TOKEN !== undefined && result.data.PLATFORM_ADMIN_TOKEN.length < 32) {
      crossFieldIssues.push('PLATFORM_ADMIN_TOKEN: üretimde en az 32 karakter olmalı');
    }
  }
  if (crossFieldIssues.length > 0) throw new EnvValidationError(crossFieldIssues);

  return Object.freeze(result.data);
}

export function corsOrigins(env: Env): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

let cached: Env | undefined;

/** Süreç genelinde tek kez doğrulanan env. Testler `parseEnv` kullanmalıdır. */
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}
