import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { EnvironmentVariables } from '../../config/env.validation';
import { LogSmsSender } from './log.sender';
import { NetgsmSmsSender } from './netgsm.sender';
import { SMS_SENDER, type SmsSender } from './sms.types';

/**
 * SMS sağlayıcısı seçimi tek yerde yapılır.
 *
 * Kimlik bilgileri EKSİKSE Netgsm hiç kurulmaz — yanlış yapılandırılmış bir
 * ortamda sessizce gerçek SMS göndermeye çalışıp hata üretmektense, içeriği
 * loga yazan gönderici çok daha güvenli bir varsayılandır.
 */
function createSmsSender(
  config: ConfigService<EnvironmentVariables, true>,
  logger: PinoLogger,
): SmsSender {
  const userCode = config.get('NETGSM_USERCODE', { infer: true });
  const password = config.get('NETGSM_PASSWORD', { infer: true });
  const msgHeader = config.get('NETGSM_MSGHEADER', { infer: true });

  if (
    userCode === undefined ||
    userCode === '' ||
    password === undefined ||
    password === '' ||
    msgHeader === undefined ||
    msgHeader === ''
  ) {
    return new LogSmsSender(logger);
  }

  return new NetgsmSmsSender(
    {
      baseUrl: config.get('NETGSM_BASE_URL', { infer: true }),
      userCode,
      password,
      msgHeader,
    },
    logger,
  );
}

@Global()
@Module({
  providers: [
    {
      provide: SMS_SENDER,
      inject: [ConfigService, PinoLogger],
      useFactory: createSmsSender,
    },
  ],
  exports: [SMS_SENDER],
})
export class SmsModule {}
