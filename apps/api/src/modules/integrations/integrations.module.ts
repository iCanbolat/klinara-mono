import { forwardRef, Module } from '@nestjs/common';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { InboxController } from './inbox.controller';
import { MessageActionsService } from './message-actions.service';
import { InboxService } from './inbox.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppSenderService } from './whatsapp-sender.service';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

/**
 * Dış sistem entegrasyonları.
 *
 * `WhatsAppSenderService` dışarıya açılan yüzdür: bildirim çekirdeği onu
 * enjekte eder ve Graph API ayrıntılarını bilmez. Ters yön YOKTUR —
 * entegrasyon modülü bildirim modülüne bağımlı değil, yalnız hata sınıflarını
 * (`send-errors.ts`) paylaşıyor.
 */
@Module({
  // ⚠️ DAİRESEL bağımlılık ve KASITLI: bildirim çekirdeği WhatsApp kanalını
  // buradan alıyor, gelen webhook ise otomatik cevabı bildirim çekirdeğinden
  // gönderiyor. İki yön de gerçek ve `forwardRef` bunun bedeli; kanalı
  // bildirim modülüne taşımak Graph API'yi çekirdeğe sokardı.
  imports: [forwardRef(() => NotificationsModule)],
  controllers: [WhatsAppController, WhatsAppWebhookController, InboxController],
  providers: [
    WhatsAppService,
    WhatsAppSenderService,
    WhatsAppWebhookService,
    InboxService,
    MessageActionsService,
    FieldEncryptionService,
  ],
  exports: [WhatsAppSenderService, MessageActionsService],
})
export class IntegrationsModule {}
