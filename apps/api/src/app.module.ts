import { Module, ValidationPipe, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { BodyShapeMiddleware } from './common/middleware/body-shape.middleware';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { OverloadGuard } from './common/overload/overload.guard';
import { PlatformAccessModule } from './common/platform/platform-access.module';
import { OverloadModule } from './common/overload/overload.module';
import { PgThrottlerStorage } from './common/rate-limit/pg-throttler.storage';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { validationExceptionFactory } from './common/pipes/validation-exception.factory';
import { validateEnv, type EnvironmentVariables } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { MailModule } from './lib/mail/mail.module';
import { QueueModule } from './lib/queue/queue.module';
import { SmsModule } from './lib/sms/sms.module';
import { StorageModule } from './lib/storage/storage.module';
import { WhatsAppModule } from './lib/whatsapp/whatsapp.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { AvailabilityCacheModule } from './modules/booking/availability-cache.module';
import { PackagesModule } from './modules/packages/packages.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { BookingModule } from './modules/booking/booking.module';
import { BookingPageModule } from './modules/booking-page/booking-page.module';
import { PublicModule } from './modules/public/public.module';
import { CrmModule } from './modules/crm/crm.module';
import { FinanceModule } from './modules/finance/finance.module';
import { FilesModule } from './modules/files/files.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
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
    OverloadModule,
    PlatformAccessModule,
    ThrottlerModule.forRootAsync({
      imports: [RateLimitModule],
      inject: [ConfigService, PgThrottlerStorage],
      useFactory: (config: ConfigService<EnvironmentVariables, true>, storage: PgThrottlerStorage) => ({
        // Sayaç süreç-içi bir `Map` değil, PAYLAŞILAN bir tablodur (10.3):
        // iki instance aynı bütçeyi harcar. `RATE_LIMIT_STORAGE=memory` eski
        // davranışa döner ve üretimde reddedilir.
        storage,
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
    WhatsAppModule,
    HealthModule,
    IdentityModule,
    CatalogModule,
    CrmModule,
    FilesModule,
    FinanceModule,
    BookingModule,
    BookingPageModule,
    PublicModule,
    PackagesModule,
    ReportingModule,
    IntegrationsModule,
    NotificationsModule,
    StaffModule,
    SchedulingModule,
    TenancyModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    // Guard SIRASI önemlidir ve kayıt sırasıyla belirlenir:
    // aşırı yük → hız sınırı → kimlik → yetki. Kimlik çözülmeden yetki
    // bakılamaz; hız sınırı ondan ucuzdur; aşırı yük kontrolü ise bir alan
    // okumasıdır ve doluluk hâlinde sayaç için veritabanına gitmenin bile
    // maliyeti vardır — bu yüzden en önde durur.
    { provide: APP_GUARD, useClass: OverloadGuard },
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
    // Sıra ÖNEMLİ: gövde biçimi kontrolü istek bağlamından sonra koşar ki
    // reddedilen istek de bir `requestId` ile loglanabilsin.
    consumer.apply(RequestContextMiddleware, BodyShapeMiddleware).forRoutes('*');
  }
}
