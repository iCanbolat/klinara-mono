import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { PackagesModule } from '../packages/packages.module';

@Module({
  // Randevu tamamlaması paket hakkını AYNI transaction'da düşer (5.3).
  imports: [PackagesModule],
  // Sıra ÖNEMLİ: `GET /appointments` (liste) CalendarController'da,
  // `GET /appointments/:id` AppointmentsController'da. Liste ucu önce
  // kaydedilmezse ":id" onu da yakalar ve liste isteği "appointments" adlı bir
  // uuid aranarak 400 döner.
  controllers: [AvailabilityController, CalendarController, AppointmentsController],
  providers: [AvailabilityService, AppointmentsService, CalendarService],
  exports: [AvailabilityService, AppointmentsService],
})
export class BookingModule {}
