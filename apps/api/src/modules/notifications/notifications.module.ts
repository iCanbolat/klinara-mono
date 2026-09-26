import { forwardRef, Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AppointmentNotifierService } from './appointment-notifier.service';
import { ChannelRegistryService } from './channel-registry.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationSenderWorker } from './notification-sender.worker';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationSettingsService } from './notification-settings.service';
import { ReminderSchedulerService } from './reminder-scheduler.service';
import { ReminderWorker } from './reminder.worker';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { StaffNotificationsController } from './staff-notifications.controller';
import { StaffNotificationsService } from './staff-notifications.service';

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
    RemindersController,
    StaffNotificationsController,
  ],
  providers: [
    NotificationSettingsService,
    MessagesService,
    NotificationDispatcherService,
    ChannelRegistryService,
    NotificationSenderWorker,
    ReminderSchedulerService,
    RemindersService,
    ReminderWorker,
    AppointmentNotifierService,
    StaffNotificationsService,
  ],
  exports: [
    NotificationDispatcherService,
    NotificationSenderWorker,
    // Randevu modülü hatırlatmaları KENDİ transaction'ında planlıyor.
    ReminderSchedulerService,
    ReminderWorker,
    AppointmentNotifierService,
    StaffNotificationsService,
  ],
})
export class NotificationsModule {}
