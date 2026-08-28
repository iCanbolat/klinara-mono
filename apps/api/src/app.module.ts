import { Module, ValidationPipe, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { validationExceptionFactory } from './common/pipes/validation-exception.factory';
import { validateEnv, type EnvironmentVariables } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { MailModule } from './lib/mail/mail.module';
import { QueueModule } from './lib/queue/queue.module';
import { SmsModule } from './lib/sms/sms.module';
import { StorageModule } from './lib/storage/storage.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { AvailabilityCacheModule } from './modules/booking/availability-cache.module';
import { PackagesModule } from './modules/packages/packages.module';
import { BookingModule } from './modules/booking/booking.module';
import { CrmModule } from './modules/crm/crm.module';
import { FilesModule } from './modules/files/files.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { StaffModule } from './modules/staff/staff.module';
import { BranchAccessModule } from './modules/tenancy/branch-access.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { LoggingModule } from './observability/logging.module';
import { MetricsModule } from './observability/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // `.env` yükleme işi `config/load-env.ts`e aittir (main.ts ve CLI
      // betikleri onu çağırır). Böylece testler yalnızca kendi kurdukları
      // `process.env`i görür; geliştiricinin yerel dosyası sızmaz.
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
    LoggingModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        throttlers: [
          {
            ttl: config.get('RATE_LIMIT_WINDOW_MS', { infer: true }),
            limit: config.get('RATE_LIMIT_MAX', { infer: true }),
          },
        ],
        // Sayaç yalnız ENTEGRASYON TESTLERİNDE kapatılır: onlarca senaryo aynı
        // süreçten ve aynı IP'den koşar, uç bazlı sıkı sınırlar (giriş:
        // dakikada 10) testleri birbirine bağımlı hâle getirirdi. Üretimde
        // kapatılamaz — env doğrulaması reddeder.
        skipIf: () => !config.get('RATE_LIMIT_ENABLED', { infer: true }),
      }),
    }),
    MetricsModule,
    DatabaseModule,
    AvailabilityCacheModule,
    BranchAccessModule,
    IdempotencyModule,
    SmsModule,
    StorageModule,
    QueueModule,
    MailModule,
    HealthModule,
    IdentityModule,
    CatalogModule,
    CrmModule,
    FilesModule,
    BookingModule,
    PackagesModule,
    StaffModule,
    SchedulingModule,
    TenancyModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    // Guard SIRASI önemlidir ve kayıt sırasıyla belirlenir:
    // hız sınırı → kimlik → yetki. Kimlik çözülmeden yetki bakılamaz;
    // hız sınırı ise en ucuz kontrol olduğu için en önde durur.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        transform: true,
        // Şemada tanımlı olmayan alanlar sessizce ELENİR; gövdeden gelen
        // beklenmedik bir alan asla veritabanına ulaşmaz.
        whitelist: true,
        transformOptions: { exposeDefaultValues: true },
        exceptionFactory: validationExceptionFactory,
      }),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
