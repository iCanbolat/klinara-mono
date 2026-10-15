import { Global, Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { EnvironmentVariables } from '../../config/env.validation';
import { ApnsPushSender } from './apns.sender';
import { FcmPushSender, type FcmServiceAccount } from './fcm.sender';
import {
  decodeSecret,
  PUSH_SENDER,
  type PushDevice,
  type PushMessage,
  type PushOutcome,
  type PushPlatform,
  type PushSender,
} from './push.types';

/**
 * Platformu doğru sağlayıcıya yönlendirir.
 *
 * Kimlik bilgisi EKSİK olan platformun bildirimi gönderilmez, yalnız loga
 * düşer (SMS/e-posta göndericileriyle aynı güvenli varsayılan). Böylece iOS
 * anahtarı gelmeden Android push'u, ya da tersi, bağımsız açılabiliyor.
 */
export class RoutingPushSender implements PushSender {
  /** Testlerin okuyabilmesi için sağlayıcısı olmayan son gönderimler. */
  readonly logged: { device: PushDevice; message: PushMessage }[] = [];

  constructor(
    private readonly apns: ApnsPushSender | undefined,
    private readonly fcm: FcmPushSender | undefined,
    private readonly logger: PinoLogger,
  ) {}

  supports(platform: PushPlatform): boolean {
    return platform === 'ios' ? this.apns !== undefined : this.fcm !== undefined;
  }

  async send(device: PushDevice, message: PushMessage): Promise<PushOutcome> {
    const sender = device.platform === 'ios' ? this.apns : this.fcm;
    if (sender !== undefined) return sender.send(device, message);

    this.logged.push({ device, message });
    if (this.logged.length > 50) this.logged.shift();
    this.logger.info(
      { provider: 'log', platform: device.platform, title: message.title },
      'Push gönderilmedi (sağlayıcı yapılandırılmamış)',
    );
    return { status: 'sent' };
  }

  close(): void {
    this.apns?.close();
  }
}

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function createPushSender(
  config: ConfigService<EnvironmentVariables, true>,
  logger: PinoLogger,
): RoutingPushSender {
  const keyId = config.get('APNS_KEY_ID', { infer: true });
  const teamId = config.get('APNS_TEAM_ID', { infer: true });
  const privateKey = config.get('APNS_PRIVATE_KEY', { infer: true });
  const bundleId = config.get('APNS_BUNDLE_ID', { infer: true });
  const apns =
    present(keyId) && present(teamId) && present(privateKey) && present(bundleId)
      ? new ApnsPushSender(
          { keyId, teamId, privateKey: decodeSecret(privateKey), bundleId },
          logger,
        )
      : undefined;

  const account = config.get('FCM_SERVICE_ACCOUNT', { infer: true });
  const fcm = present(account)
    ? new FcmPushSender(JSON.parse(decodeSecret(account)) as FcmServiceAccount)
    : undefined;

  return new RoutingPushSender(apns, fcm, logger);
}

@Global()
@Module({
  providers: [
    {
      provide: PUSH_SENDER,
      inject: [ConfigService, PinoLogger],
      useFactory: createPushSender,
    },
  ],
  exports: [PUSH_SENDER],
})
export class PushModule implements OnApplicationShutdown {
  constructor(@Inject(PUSH_SENDER) private readonly sender: RoutingPushSender) {}

  onApplicationShutdown(): void {
    this.sender.close();
  }
}
