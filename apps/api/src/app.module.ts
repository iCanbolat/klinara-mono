import { Module, ValidationPipe, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { validationExceptionFactory } from './common/pipes/validation-exception.factory';
import { validateEnv, type EnvironmentVariables } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
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
      }),
    }),
    MetricsModule,
    DatabaseModule,
    HealthModule,
    TenancyModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
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
