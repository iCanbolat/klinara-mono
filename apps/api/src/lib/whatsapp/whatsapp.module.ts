import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { EnvironmentVariables } from '../../config/env.validation';
import { GraphWhatsAppClient } from './graph.client';
import { WHATSAPP_CLIENT, type WhatsAppClient } from './whatsapp.types';

/**
 * WhatsApp istemcisi.
 *
 * SMS ve e-postadan farkı: kimlik bilgileri env'de değil, KİRACI BAŞINA
 * veritabanında (şifreli) durur. Bu yüzden burada "yapılandırılmış mı"
 * kararı verilmez — istemci her zaman kurulur, kimlik bilgisini çağıran taşır.
 * Yapılandırma eksikse hata servis katmanından gelir
 * (`WHATSAPP_NOT_CONFIGURED`).
 *
 * `WHATSAPP_API_BASE_URL` testlerde yerel mock sunucuya çevrilir; üretimde
 * Meta Graph API'dir.
 */
@Global()
@Module({
  providers: [
    {
      provide: WHATSAPP_CLIENT,
      inject: [ConfigService, PinoLogger],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
        logger: PinoLogger,
      ): WhatsAppClient =>
        new GraphWhatsAppClient(
          {
            baseUrl: config.get('WHATSAPP_API_BASE_URL', { infer: true }),
            timeoutMs: config.get('WHATSAPP_TIMEOUT_MS', { infer: true }),
          },
          logger,
        ),
    },
  ],
  exports: [WHATSAPP_CLIENT],
})
export class WhatsAppModule {}
