import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerParams } from './logger.config';

/**
 * pino'yu uygulamanın tek logger'ı yapar ve HER modülde enjekte edilebilir
 * kılar (`@Global`) — hata filtresi ve veritabanı havuzu gibi altyapı
 * parçalarının da aynı yapılandırılmış logger'a ihtiyacı var.
 */
@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildLoggerParams,
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
