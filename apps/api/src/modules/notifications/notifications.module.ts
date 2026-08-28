import { forwardRef, Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ChannelRegistryService } from './channel-registry.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationSenderWorker } from './notification-sender.worker';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationSettingsService } from './notification-settings.service';
import { OptOutsController } from './opt-outs.controller';
import { ReminderSchedulerService } from './reminder-scheduler.service';
import { ReminderWorker } from './reminder.worker';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { OptOutsService } from './opt-outs.service';

/**
 * Bildirim çekirdeği.
 *
 * `NotificationDispatcherService` DIŞARIYA açılan tek yüzdür: randevu, paket
 * ve finans modülleri yalnız onu enjekte eder, kanal/şablon/sağlayıcı bilmez.
 */
@Module({
  // WhatsApp kanalı entegrasyon modülünden geliyor; ters yön yok.
  imports: [forwardRef(() => IntegrationsModule)],
  controllers: [
    NotificationSettingsController,
    MessagesController,
    OptOutsController,
    RemindersController,
  ],
  providers: [
    NotificationSettingsService,
    MessagesService,
    OptOutsService,
    NotificationDispatcherService,
    ChannelRegistryService,
    NotificationSenderWorker,
    ReminderSchedulerService,
    RemindersService,
    ReminderWorker,
  ],
  exports: [
    NotificationDispatcherService,
    NotificationSenderWorker,
    // Randevu modülü hatırlatmaları KENDİ transaction'ında planlıyor.
    ReminderSchedulerService,
    ReminderWorker,
  ],
})
export class NotificationsModule {}
