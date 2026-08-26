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
  MinLength,
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
/** `15m`, `30d`, `900s` — jose'un kabul ettiği süre biçimi. */
const DURATION =
  /^\d+\s?(s|m|h|d|w|y|sec|secs|second|seconds|min|mins|minute|minutes|hour|hours|day|days|week|weeks|year|years)$/;
/** base64 kodlanmış 32 bayt (opsiyonel dolgu dahil 44 karakter). */
const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/;

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

  /**
   * Hız sınırı sayacı. Yalnız test ortamında kapatılır; üretimde kapatılamaz
   * (aşağıdaki ortam kuralına bakın).
   */
  @Expose()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  RATE_LIMIT_ENABLED: boolean = true;

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

  /**
   * Platform yönetimi uçları (`/platform/*`) için bearer token.
   *
   * Kiracı kullanıcılarının kimliği Batch 1.2'den beri JWT ile çözülür; platform
   * yöneticiliği ise kiracı-üstü bir işlemdir ve kendi kanalında durur.
   */
  @Expose()
  @IsOptional()
  @IsString()
  PLATFORM_ADMIN_TOKEN?: string;

  // --- Kimlik (Faz 1) ---
  /**
   * Access ve ara token'ların HS256 imza anahtarı. En az 32 karakter.
   *
   * Değiştirilmesi TÜM access token'ları geçersiz kılar (refresh token'lar
   * veritabanında olduğu için etkilenmez) — bu, acil durumda istenen davranıştır.
   */
  @Expose()
  @IsString({ message: 'zorunludur' })
  @MinLength(32, { message: 'en az 32 karakter olmalı' })
  JWT_SECRET: string;

  /** Access token ömrü. Kısa tutulur: iptal, süresi dolana kadar gecikir. */
  @Expose()
  @Matches(DURATION, { message: "süre biçimi olmalı (ör. '15m', '30d')" })
  JWT_ACCESS_TTL: string = '15m';

  @Expose()
  @Matches(DURATION, { message: "süre biçimi olmalı (ör. '15m', '30d')" })
  JWT_REFRESH_TTL: string = '30d';

  /** Kiracı seçimi ve 2FA ara token'ının ömrü. */
  @Expose()
  @Matches(DURATION, { message: "süre biçimi olmalı (ör. '5m')" })
  JWT_CHALLENGE_TTL: string = '5m';

  /**
   * argon2id parametreleri. Varsayılanlar OWASP'ın 2024 önerisidir
   * (19 MiB bellek, 2 geçiş, tek iş parçacığı).
   *
   * Bellek maliyeti GPU paralelliğini sınırlar — bcrypt'te olmayan şey budur.
   * Düşürülmesi doğrudan kırılma maliyetini düşürür.
   */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(8_192)
  ARGON2_MEMORY_COST: number = 19_456;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  ARGON2_TIME_COST: number = 2;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(16)
  ARGON2_PARALLELISM: number = 1;

  /** Kademeli kilit: pencere içinde bu kadar başarısız denemeden sonra kilit. */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  LOGIN_MAX_ATTEMPTS: number = 5;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  LOGIN_ATTEMPT_WINDOW_MINUTES: number = 15;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  INVITATION_TTL_HOURS: number = 168;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  PASSWORD_RESET_TTL_MINUTES: number = 30;

  /**
   * Özel nitelikli veri ve TOTP sırrı için AES-256-GCM anahtarı: base64
   * kodlanmış 32 BAYT. Anahtar kaybı, şifreli alanların kalıcı kaybıdır.
   */
  @Expose()
  @IsString({ message: 'zorunludur' })
  @Matches(BASE64_32, { message: '32 baytlık base64 değer olmalı' })
  FIELD_ENCRYPTION_KEY: string;

  /** Rotasyon etiketi: şifreli satırlar hangi anahtarla yazıldığını taşır. */
  @Expose()
  @IsString()
  @IsNotEmpty()
  FIELD_ENCRYPTION_KEY_ID: string = 'v1';

  // --- Passkey (WebAuthn) ---
  /**
   * `rpId` uygulamanın kayıtlı olduğu ETKİN ALAN ADIDIR ve sonradan
   * DEĞİŞTİRİLEMEZ: değişirse kayıtlı tüm passkey'ler geçersizleşir.
   */
  @Expose()
  @IsString()
  @IsNotEmpty()
  WEBAUTHN_RP_ID: string = 'localhost';

  @Expose()
  @IsString()
  @IsNotEmpty()
  WEBAUTHN_RP_NAME: string = 'Klinara';

  /**
   * Virgülle ayrılmış izinli origin listesi. Native uygulamalar için
   * `android:apk-key-hash:...` ve iOS için `https://<rpId>` buraya girer.
   */
  @Expose()
  @IsString()
  WEBAUTHN_ORIGINS: string = 'http://localhost:5173';

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  WEBAUTHN_CHALLENGE_TTL_MINUTES: number = 5;

  // --- SMS / telefon doğrulama (Netgsm) ---
  /** Tanımsızsa SMS GÖNDERİLMEZ; içerik yalnız loga yazılır (yerel geliştirme). */
  @Expose()
  @IsOptional()
  @IsString()
  NETGSM_USERCODE?: string;

  @Expose()
  @IsOptional()
  @IsString()
  NETGSM_PASSWORD?: string;

  /** Netgsm'de onaylı gönderici başlığı. */
  @Expose()
  @IsOptional()
  @IsString()
  NETGSM_MSGHEADER?: string;

  @Expose()
  @IsString()
  NETGSM_BASE_URL: string = 'https://api.netgsm.com.tr';

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  PHONE_VERIFICATION_TTL_MINUTES: number = 5;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  PHONE_VERIFICATION_MAX_ATTEMPTS: number = 5;

  /** İki SMS arasındaki en kısa süre. SMS PARALIDIR — sınırsız uç, faturaya yazılan bir saldırı yüzeyidir. */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  PHONE_VERIFICATION_RESEND_SECONDS: number = 60;

  /** Davet ve parola sıfırlama bağlantılarının gösterileceği web adresi. */
  @Expose()
  @IsString()
  @IsNotEmpty()
  APP_BASE_URL: string = 'http://localhost:5173';
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
  if (!env.RATE_LIMIT_ENABLED) {
    issues.push('RATE_LIMIT_ENABLED: üretimde kapatılamaz — hız sınırı zorunludur');
  }
  if (env.WEBAUTHN_ORIGINS.split(',').some((origin) => origin.trim().startsWith('http://'))) {
    issues.push(
      'WEBAUTHN_ORIGINS: üretimde http:// origin olamaz (passkey yalnız güvenli kaynakta çalışır)',
    );
  }
  if (env.APP_BASE_URL.startsWith('http://')) {
    issues.push(
      'APP_BASE_URL: üretimde https:// olmalı — davet ve sıfırlama bağlantıları buradan üretilir',
    );
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
  return splitList(env.CORS_ORIGINS);
}

/** Virgülle ayrılmış listeyi temizleyerek diziye çevirir. */
export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
