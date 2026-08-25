// Dekoratör metadata'sı için polyfill. Bu modül `main.ts`in yanı sıra CLI
// betiklerinden de (db:migrate, db:seed) yükleniyor; polyfill'i burada garanti
// altına alıyoruz.
import 'reflect-metadata';
import { Expose, Transform, Type, plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/**
 * Ortam değişkenleri — süreç açılışında doğrulanır.
 *
 * Kural: `process.env`e uygulama kodunun herhangi bir yerinden DOĞRUDAN
 * erişilmez. Tek giriş noktası burasıdır; okuma `ConfigService` üzerinden
 * yapılır. Böylece hem tipler güvenlidir hem de eksik yapılandırma üretimde
 * değil, açılışta fark edilir.
 */

const POSTGRES_URL = /^postgres(ql)?:\/\//;

/** `'true'` / `'false'` metnini boolean'a çevirir; tanımsızsa dokunmaz. */
function toBoolean() {
  return Transform(({ value }: { value: unknown }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  );
}

export class EnvironmentVariables {
  @Expose()
  @IsIn(['development', 'test', 'production'], {
    message: 'development, test veya production olmalı',
  })
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @Expose()
  @IsString()
  @IsNotEmpty()
  HOST: string = '0.0.0.0';

  @Expose()
  @Type(() => Number)
  @IsInt({ message: 'geçerli bir port numarası olmalı' })
  @Min(1)
  @Max(65_535)
  PORT: number = 3000;

  @Expose()
  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL: string = 'info';

  /** SIGTERM sonrası in-flight isteklere tanınan süre; sonunda süreç zorla kapanır. */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  SHUTDOWN_GRACE_MS: number = 10_000;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  BODY_LIMIT_BYTES: number = 1_048_576;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_MAX: number = 300;

  /** Hız sınırı penceresi (ms). Fastify'ın `'1 minute'` metin biçimi değil. */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  RATE_LIMIT_WINDOW_MS: number = 60_000;

  /** Virgülle ayrılmış origin listesi. Boşsa tarayıcı kaynaklı çapraz istek kabul edilmez. */
  @Expose()
  @IsString()
  CORS_ORIGINS: string = '';

  // --- Veritabanı ---
  /**
   * Uygulama bağlantısı. Bu rol NOBYPASSRLS olmalıdır; kiracı izolasyonunun
   * veritabanı seviyesinde zorlanması buna bağlıdır.
   */
  @Expose()
  @IsString({ message: 'zorunludur' })
  @Matches(POSTGRES_URL, { message: 'postgres:// veya postgresql:// ile başlamalı' })
  DATABASE_URL: string;

  /**
   * Migration bağlantısı (tabloların sahibi, RLS'i bypass eder).
   * Yalnız `db:migrate` için gerekir; API süreci bunu kullanmaz.
   */
  @Expose()
  @IsOptional()
  @Matches(POSTGRES_URL, { message: 'postgres:// veya postgresql:// ile başlamalı' })
  DATABASE_MIGRATION_URL?: string;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  DATABASE_POOL_MAX: number = 20;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  DATABASE_STATEMENT_TIMEOUT_MS: number = 10_000;

  // --- Gözlemlenebilirlik ---
  @Expose()
  @IsString()
  @IsNotEmpty()
  SERVICE_NAME: string = 'klinara-api';

  @Expose()
  @IsString()
  @IsNotEmpty()
  SERVICE_VERSION: string = '0.0.0';

  /** Tanımlıysa OpenTelemetry açılır; boşsa telemetri hiç kurulmaz. */
  @Expose()
  @IsOptional()
  @IsString()
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;

  /** Tanımlıysa Sentry açılır. */
  @Expose()
  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  @Expose()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  SENTRY_TRACES_SAMPLE_RATE: number = 0.1;

  /**
   * `/metrics` ucunu koruyan bearer token. Üretimde ZORUNLU — aksi hâlde
   * iç metrikler herkese açık olur (aşağıdaki ortam bazlı kurallara bakın).
   */
  @Expose()
  @IsOptional()
  @IsString()
  METRICS_TOKEN?: string;

  // --- Geçici kimlik köprüsü (Faz 1'de kaldırılacak) ---
  /**
   * Platform yönetimi uçları (`/platform/*`) için bearer token.
   * Faz 1.2'de gerçek JWT kimliğine devredilecek.
   */
  @Expose()
  @IsOptional()
  @IsString()
  PLATFORM_ADMIN_TOKEN?: string;

  /**
   * Açıkken kiracı context'i `X-Tenant-Id` / `X-User-Id` başlıklarından okunur.
   * ÜRETİMDE YASAKTIR — env doğrulaması buna izin vermez.
   */
  @Expose()
  @toBoolean()
  @IsBoolean()
  AUTH_DEV_MODE: boolean = false;
}

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Ortam değişkeni doğrulaması başarısız:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/** Şema ile ifade edilemeyen, ortama bağlı kurallar. */
function crossFieldIssues(env: EnvironmentVariables): string[] {
  const issues: string[] = [];
  if (env.NODE_ENV !== 'production') return issues;

  if (env.METRICS_TOKEN === undefined || env.METRICS_TOKEN.length < 16) {
    issues.push(
      'METRICS_TOKEN: üretimde zorunlu ve en az 16 karakter olmalı (/metrics ucu korunmalı)',
    );
  }
  if (env.CORS_ORIGINS.trim() === '') {
    issues.push('CORS_ORIGINS: üretimde açıkça tanımlanmalı');
  }
  if (env.AUTH_DEV_MODE) {
    issues.push('AUTH_DEV_MODE: üretimde açık olamaz — kimlik doğrulamasını başlıkla atlatır');
  }
  if (env.PLATFORM_ADMIN_TOKEN !== undefined && env.PLATFORM_ADMIN_TOKEN.length < 32) {
    issues.push('PLATFORM_ADMIN_TOKEN: üretimde en az 32 karakter olmalı');
  }
  return issues;
}

/**
 * `ConfigModule.forRoot({ validate })` bunu çağırır; dönen nesne
 * `ConfigService`in tek gerçek kaynağıdır (ham `process.env` değil).
 *
 * Bilinmeyen anahtarlar KASITLI olarak elenir (`excludeExtraneousValues`):
 * yapılandırmaya yalnızca burada tanımlanmış değişkenler girer.
 */
export function validateEnv(source: Record<string, unknown> = process.env): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, source, {
    excludeExtraneousValues: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(env, { skipMissingProperties: false, whitelist: false });
  const issues = errors.flatMap((error) =>
    Object.values(error.constraints ?? {}).map((message) => `${error.property}: ${message}`),
  );
  if (issues.length > 0) throw new EnvValidationError(issues);

  const crossIssues = crossFieldIssues(env);
  if (crossIssues.length > 0) throw new EnvValidationError(crossIssues);

  return Object.freeze(env);
}

export function corsOrigins(env: Pick<EnvironmentVariables, 'CORS_ORIGINS'>): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
