import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { TenantTxService } from '../../database/tenant-tx.service';
import { BranchAccessService } from '../tenancy/branch-access.service';
import type { Principal } from '../identity/principal';
import * as repo from './reminders.repository';
import type {
  BranchReminderSettingsDto,
  ScheduledNotificationDto,
  UpdateBranchReminderSettingsDto,
} from './dto/reminder.dto';

@Injectable()
export class RemindersService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async getBranchSettings(
    principal: Principal,
    branchId: string,
  ): Promise<BranchReminderSettingsDto> {
    await this.branchAccess.assertInput(principal, branchId);

    const payload = await this.tx.run(async (tx) => ({
      settings: await repo.findBranchSettings(tx, branchId),
      // Yürürlükteki saatler: şube ayarı boşsa kiracı ayarı.
      hours: await repo.resolveReminderHours(tx, branchId),
    }));

    return {
      branchId,
      reminderHoursBefore: payload.hours,
      isBranchOverride: (payload.settings?.reminderHoursBefore.length ?? 0) > 0,
      noShowFollowupEnabled: payload.settings?.noShowFollowupEnabled ?? true,
      noShowFollowupDelayHours: payload.settings?.noShowFollowupDelayHours ?? 2,
    };
  }

  async updateBranchSettings(
    principal: Principal,
    branchId: string,
    input: UpdateBranchReminderSettingsDto,
  ): Promise<BranchReminderSettingsDto> {
    await this.branchAccess.assertInput(principal, branchId);

    await this.tx.run(async (tx) => {
      const current = await repo.findBranchSettings(tx, branchId);
      await repo.upsertBranchSettings(tx, this.tx.tenantId, branchId, {
        reminderHoursBefore: input.reminderHoursBefore ?? current?.reminderHoursBefore ?? [],
        noShowFollowupEnabled:
          input.noShowFollowupEnabled ?? current?.noShowFollowupEnabled ?? true,
        noShowFollowupDelayHours:
          input.noShowFollowupDelayHours ?? current?.noShowFollowupDelayHours ?? 2,
      });
    });

    return this.getBranchSettings(principal, branchId);
  }

  /**
   * Randevunun bildirim planı.
   *
   * `superseded` ve `cancelled` satırlar da DÖNER: "hatırlatma neden gitmedi?"
   * sorusunun cevabı tam da o satırlardadır.
   */
  async listForAppointment(
    principal: Principal,
    appointmentId: string,
  ): Promise<ScheduledNotificationDto[]> {
    const payload = await this.tx.run(async (tx) => {
      const appointment = await repo.findAppointmentSummary(tx, appointmentId);
      if (appointment === undefined) return undefined;
      BranchAccessService.assertMembership(principal, appointment.branchId);
      return repo.listScheduledForAppointment(tx, appointmentId);
    });

    if (payload === undefined) throw AppError.notFound('Randevu bulunamadı');

    return payload.map((row) => ({
      id: row.id,
      event: row.event,
      offsetHours: row.offsetHours,
      scheduledFor: row.scheduledFor.toISOString(),
      status: row.status,
      messageId: row.messageLogId,
    }));
  }
}
