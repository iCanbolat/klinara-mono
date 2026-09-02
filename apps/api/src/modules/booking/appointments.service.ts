import { Injectable } from '@nestjs/common';
import { ERROR_CODES, PERMISSIONS, type Permission } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { toZonedIso } from '../../common/time';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import type { AppointmentStatus } from '../../database/schema/appointments';
import { ChargeGenerationService } from '../finance/charge-generation.service';
import { CommissionAccrualService } from '../finance/commission-accrual.service';
import { ChargesService } from '../finance/charges.service';
import { CommissionsService } from '../finance/commissions.service';
import { CustomerPackagesService } from '../packages/customer-packages.service';
import { PackageConsumptionService } from '../packages/package-consumption.service';
import type { Principal } from '../identity/principal';
import { hasPermission } from '../identity/principal';
import { BranchAccessService } from '../tenancy/branch-access.service';
import { AvailabilityCacheService } from './availability-cache.service';
import { AvailabilityService } from './availability.service';
import { ReminderSchedulerService } from '../notifications/reminder-scheduler.service';
import * as repo from './appointments.repository';
import * as settingsRepo from './booking-settings.repository';
import type {
  AppointmentHistoryEntryDto,
  AppointmentResponseDto,
  AppointmentServiceInputDto,
  AppointmentServiceResponseDto,
  CancelAppointmentDto,
  ChangeAppointmentStatusDto,
  CreateAppointmentDto,
  RescheduleAppointmentDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto';

/** Çakışma yanıtında önerilecek alternatif slot sayısı. */
const SUGGESTION_LIMIT = 3;

interface PlannedService {
  serviceId: string;
  staffProfileId: string;
  sortOrder: number;
  visibleStart: Date;
  visibleEnd: Date;
  occupiedStart: Date;
  occupiedEnd: Date;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceMinor: number;
  vatRateBasisPoints: number;
  customerPackageItemId: string | null;
}

interface Plan {
  services: PlannedService[];
  visibleStart: Date;
  visibleEnd: Date;
  /** Personel başına, buffer DAHİL tek bir işgal aralığı. */
  staffSpans: { staffProfileId: string; from: Date; to: Date }[];
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly availability: AvailabilityService,
    private readonly cache: AvailabilityCacheService,
    private readonly branchAccess: BranchAccessService,
    private readonly consumption: PackageConsumptionService,
    private readonly chargeGeneration: ChargeGenerationService,
    private readonly commissions: CommissionAccrualService,
    private readonly reminders: ReminderSchedulerService,
  ) {}

  // ---------------------------------------------------------------------------
  // Oluşturma
  // ---------------------------------------------------------------------------
  async create(
    principal: Principal,
    input: CreateAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    await this.branchAccess.assertInput(principal, input.branchId);
    const startsAt = AppointmentsService.parseInstant(input.startsAt);

    const created = await this.tx
      .run(async (tx) => {
        const plan = await this.buildPlan(tx, input.branchId, startsAt, input.services);
        await AppointmentsService.assertSchedule(tx, input.branchId, plan);

        const appointment = await repo.insertAppointment(tx, {
          tenantId: this.tx.tenantId,
          branchId: input.branchId,
          customerId: input.customerId,
          startsAt: plan.visibleStart,
          endsAt: plan.visibleEnd,
          notes: input.notes,
          createdBy: principal.userId,
        });

        await this.writePlan(tx, appointment.id, input.branchId, input.customerId, plan);

        await repo.insertHistory(tx, {
          tenantId: this.tx.tenantId,
          appointmentId: appointment.id,
          actorUserId: principal.userId,
          action: 'created',
          toStatus: appointment.status,
          newStartsAt: appointment.startsAt,
        });

        // Hatırlatma AYNI transaction'da planlanır (8.4): randevu rollback
        // olursa hatırlatma satırı da pg-boss işi de yazılmaz. Outbox'a bu
        // yüzden gerek yok (mimari karar 4.6).
        await this.reminders.scheduleForAppointment(tx, {
          tenantId: this.tx.tenantId,
          appointmentId: appointment.id,
          branchId: input.branchId,
          startsAt: appointment.startsAt,
          status: appointment.status,
        });

        const services = await repo.listAppointmentServices(tx, appointment.id);
        return { appointment, services };
      })
      .catch((error: unknown) => this.translateWrite(error, input.branchId, startsAt, input.services));

    this.cache.invalidateTenant(this.tx.tenantId);
    return this.present(created.appointment, created.services);
  }

  /**
   * Yetki kontrolü OLMADAN randevu yazar — online randevu sayfası için.
   *
   * `computeSlots` ile aynı kalıp ve aynı gerekçe: erişim kararı çağıran uçta
   * (`PublicSiteGuard` + slot token doğrulaması) çoktan verilmiştir. Sahte bir
   * `Principal` üretmek yerine kontrolü açıkça dışarıda bırakmak, hangi yolun
   * yetkiden geçtiğini okunur kılıyor.
   *
   * ⚠️ PLANLAYICI PAYLAŞILIYOR. `buildPlan` / `assertSchedule` / `writePlan`
   * ikinci bir kopyaya çıkarılmadı: buffer, yetkinlik ve çalışma saati
   * kuralları iki yolda ayrışsaydı, ayrışma ancak üretimde — bir müşteri
   * gelip yer bulamadığında — fark edilirdi.
   *
   * `prepare` callback'i randevu satırları yazılmadan ÖNCE, AYNI transaction
   * içinde koşar. Online akışta tutmayı serbest bırakmak için kullanılıyor:
   * hold hâlâ aktifken randevu yazılsaydı, randevu KENDİ tutmasına çakışırdı.
   */
  async createUnauthorized(input: {
    branchId: string;
    customerId: string;
    startsAt: string;
    services: AppointmentServiceInputDto[];
    notes?: string | undefined;
    prepare?: (tx: Tx) => Promise<void>;
  }): Promise<AppointmentResponseDto> {
    const startsAt = AppointmentsService.parseInstant(input.startsAt);

    const created = await this.tx
      .run(async (tx) => {
        const plan = await this.buildPlan(tx, input.branchId, startsAt, input.services);
        await AppointmentsService.assertSchedule(tx, input.branchId, plan);

        if (input.prepare !== undefined) await input.prepare(tx);

        const appointment = await repo.insertAppointment(tx, {
          tenantId: this.tx.tenantId,
          branchId: input.branchId,
          customerId: input.customerId,
          startsAt: plan.visibleStart,
          endsAt: plan.visibleEnd,
          notes: input.notes,
          // Aktör YOK: randevuyu bir personel değil müşterinin kendisi açtı.
          // `created_by`ye bir kullanıcı uydurmak, denetim kaydını yalan
          // söyler hâle getirirdi.
          createdBy: null,
          origin: 'online',
        });

        await this.writePlan(tx, appointment.id, input.branchId, input.customerId, plan);

        await repo.insertHistory(tx, {
          tenantId: this.tx.tenantId,
          appointmentId: appointment.id,
          actorUserId: null,
          action: 'created',
          toStatus: appointment.status,
          newStartsAt: appointment.startsAt,
        });

        await this.reminders.scheduleForAppointment(tx, {
          tenantId: this.tx.tenantId,
          appointmentId: appointment.id,
          branchId: input.branchId,
          startsAt: appointment.startsAt,
          status: appointment.status,
        });

        const services = await repo.listAppointmentServices(tx, appointment.id);
        return { appointment, services };
      })
      .catch((error: unknown) =>
        this.translateWrite(error, input.branchId, startsAt, input.services),
      );

    this.cache.invalidateTenant(this.tx.tenantId);
    return this.present(created.appointment, created.services);
  }

  // ---------------------------------------------------------------------------
  // Okuma
  // ---------------------------------------------------------------------------
  async get(principal: Principal, id: string): Promise<AppointmentResponseDto> {
    const payload = await this.tx.run(async (tx) => {
      const appointment = await repo.findAppointmentById(tx, id);
      if (appointment === undefined) return undefined;
      const services = await repo.listAppointmentServices(tx, id);
      return { appointment, services };
    });

    if (payload === undefined) throw AppError.notFound('Randevu bulunamadı');
    BranchAccessService.assertMembership(principal, payload.appointment.branchId);
    await this.assertVisible(principal, payload.services);
    return this.present(payload.appointment, payload.services);
  }

  async history(principal: Principal, id: string): Promise<AppointmentHistoryEntryDto[]> {
    const payload = await this.tx.run(async (tx) => {
      const appointment = await repo.findAppointmentById(tx, id);
      if (appointment === undefined) return undefined;
      const services = await repo.listAppointmentServices(tx, id);
      const rows = await repo.listHistory(tx, id);
      return { appointment, services, rows };
    });

    if (payload === undefined) throw AppError.notFound('Randevu bulunamadı');
    BranchAccessService.assertMembership(principal, payload.appointment.branchId);
    await this.assertVisible(principal, payload.services);

    return payload.rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorUserId: row.actorUserId,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      oldStartsAt: row.oldStartsAt?.toISOString() ?? null,
      newStartsAt: row.newStartsAt?.toISOString() ?? null,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------------------
  // Güncelleme
  // ---------------------------------------------------------------------------
  async update(
    principal: Principal,
    id: string,
    expectedVersion: number,
    input: UpdateAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    const payload = await this.tx.run(async (tx) => {
      const current = await repo.findAppointmentById(tx, id);
      if (current === undefined) return undefined;
      BranchAccessService.assertMembership(principal, current.branchId);

      const updated = await repo.updateWithVersion(tx, id, expectedVersion, {
        notes: input.notes ?? null,
      });
      if (updated === undefined) return { conflict: true as const, current };

      await repo.insertHistory(tx, {
        tenantId: this.tx.tenantId,
        appointmentId: id,
        actorUserId: principal.userId,
        action: 'updated',
      });

      const services = await repo.listAppointmentServices(tx, id);
      return { appointment: updated, services };
    });

    if (payload === undefined) throw AppError.notFound('Randevu bulunamadı');
    if ('conflict' in payload) throw AppointmentsService.versionConflict();
    return this.present(payload.appointment, payload.services);
  }

  // ---------------------------------------------------------------------------
  // Erteleme
  // ---------------------------------------------------------------------------
  async reschedule(
    principal: Principal,
    id: string,
    expectedVersion: number,
    input: RescheduleAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    return this.rescheduleInternal(principal, id, expectedVersion, input);
  }

  /** `principal === null` → self-servis yolu (bkz. `rescheduleUnauthorized`). */
  private async rescheduleInternal(
    principal: Principal | null,
    id: string,
    expectedVersion: number,
    input: RescheduleAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    const startsAt = AppointmentsService.parseInstant(input.startsAt);
    let branchId = '';
    let entries: AppointmentServiceInputDto[] = [];

    const payload = await this.tx
      .run(async (tx) => {
        const current = await repo.findAppointmentById(tx, id);
        if (current === undefined) return undefined;
        if (principal !== null) BranchAccessService.assertMembership(principal, current.branchId);
        AppointmentsService.assertMutable(current.status);

        branchId = current.branchId;
        const existing = await repo.listAppointmentServices(tx, id);
        entries =
          input.services ??
          existing.map((row) => ({
            serviceId: row.serviceId,
            staffProfileId: row.staffProfileId,
          }));

        const plan = await this.buildPlan(tx, current.branchId, startsAt, entries);
        await AppointmentsService.assertSchedule(tx, current.branchId, plan);

        // Eski işgali ÖNCE kapatıyoruz; aynı transaction içinde olduğu için
        // randevu kendi kendisiyle çakışmaz ve arada slot serbest kalmaz.
        await repo.deactivateBookings(tx, id);
        await repo.deleteAppointmentServices(tx, id);

        const updated = await repo.updateWithVersion(tx, id, expectedVersion, {
          startsAt: plan.visibleStart,
          endsAt: plan.visibleEnd,
        });
        if (updated === undefined) return { conflict: true as const };

        await this.writePlan(tx, id, current.branchId, current.customerId, plan);

        await repo.insertHistory(tx, {
          tenantId: this.tx.tenantId,
          appointmentId: id,
          actorUserId: principal?.userId ?? null,
          action: 'rescheduled',
          oldStartsAt: current.startsAt,
          newStartsAt: plan.visibleStart,
          reason: input.reason ?? null,
        });

        // Eski plan `superseded`, yeni saate göre yeniden planlanır.
        await this.reminders.reschedule(tx, {
          tenantId: this.tx.tenantId,
          appointmentId: id,
          branchId: current.branchId,
          startsAt: updated.startsAt,
          status: updated.status,
        });

        const services = await repo.listAppointmentServices(tx, id);
        return { appointment: updated, services };
      })
      .catch((error: unknown) => this.translateWrite(error, branchId, startsAt, entries));

    if (payload === undefined) throw AppError.notFound('Randevu bulunamadı');
    if ('conflict' in payload) throw AppointmentsService.versionConflict();

    this.cache.invalidateTenant(this.tx.tenantId);
    return this.present(payload.appointment, payload.services);
  }

  /**
   * Self-servis erteleme — aktör YOK (Batch 9.5).
   *
   * Erteleme, iptal + yeni randevu DEĞİL: `appointments.id` ve
   * `appointment_history` zinciri korunuyor. Müşteri kartındaki geçmiş,
   * "erteledi" ile "iptal edip yeniden aldı" arasındaki farkı görebilmeli.
   *
   * Sürüm kontrolü `expectedVersion` yerine SATIRIN KENDİ sürümüyle yapılıyor:
   * müşterinin elinde bir ETag yok ve olması da beklenmez. Yarış hâlinde
   * kaybeden taraf EXCLUDE constraint'ine takılır, sessizce üzerine yazmaz.
   */
  async rescheduleUnauthorized(
    id: string,
    startsAtIso: string,
    reason?: string,
  ): Promise<AppointmentResponseDto> {
    const current = await this.tx.run((tx) => repo.findAppointmentById(tx, id));
    if (current === undefined) throw AppError.notFound('Randevu bulunamadı');
    return this.rescheduleInternal(null, id, current.version, {
      startsAt: startsAtIso,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  // ---------------------------------------------------------------------------
  // İptal ve durum
  // ---------------------------------------------------------------------------
  async cancel(
    principal: Principal,
    id: string,
    input: CancelAppointmentDto,
  ): Promise<AppointmentResponseDto> {
    const payload = await this.changeStatus(principal, id, 'cancelled', input.reason);
    this.cache.invalidateTenant(this.tx.tenantId);
    return payload;
  }

  /**
   * Self-servis iptal — aktör YOK (Batch 9.5).
   *
   * Erişim kararı çağıran uçta, tek randevuya kapsanmış imzalı token'la
   * verilmiştir. İptal penceresi kontrolü de orada; bu metot yalnız durum
   * geçişini ve onun yan etkilerini (hatırlatma iptali, cache) yürütür.
   */
  async cancelUnauthorized(id: string, reason: string | undefined): Promise<AppointmentResponseDto> {
    const payload = await this.changeStatus(null, id, 'cancelled', reason);
    this.cache.invalidateTenant(this.tx.tenantId);
    return payload;
  }

  async setStatus(
    principal: Principal,
    id: string,
    input: ChangeAppointmentStatusDto,
  ): Promise<AppointmentResponseDto> {
    const payload = await this.changeStatus(principal, id, input.status, input.reason);
    this.cache.invalidateTenant(this.tx.tenantId);
    return payload;
  }

  /**
   * `principal === null` → self-servis yolu (Batch 9.5).
   *
   * Müşteri bir kullanıcı değil; şube üyeliği ve izin kontrolü onun için
   * ANLAMSIZ. Erişim kararı çağıran uçta, tek randevuya kapsanmış imzalı
   * token'la verilmiştir. Sahte bir `Principal` üretmek yerine `null` geçmek,
   * hangi yolun yetkiden geçtiğini okunur bırakıyor.
   */
  private async changeStatus(
    principal: Principal | null,
    id: string,
    status: AppointmentStatus,
    reason: string | undefined,
  ): Promise<AppointmentResponseDto> {
    const payload = await this.tx
      .run(async (tx) => {
        const current = await repo.findAppointmentById(tx, id);
        if (current === undefined) return undefined;
        if (principal !== null) BranchAccessService.assertMembership(principal, current.branchId);

        if (current.status === status) {
          const services = await repo.listAppointmentServices(tx, id);
          return { appointment: current, services };
        }

        // Geçişi ÖNCE serviste kontrol ediyoruz — anlamlı bir mesaj için.
        // Trigger yine devrede: son savunma hattı odur, bu değil.
        const transition = await repo.findAllowedTransition(tx, current.status, status);
        if (transition === undefined) {
          throw new AppError(
            409,
            ERROR_CODES.INVALID_STATUS_TRANSITION,
            `Geçersiz durum geçişi: ${current.status} → ${status}`,
          );
        }
        if (
          principal !== null &&
          transition.requiredPermission !== null &&
          !hasPermission(principal, transition.requiredPermission as Permission)
        ) {
          throw AppError.forbidden('Bu durum değişikliği için yetkiniz yok', {
            detail: `Gereken izin: ${transition.requiredPermission}`,
          });
        }

        const isCancel = status === 'cancelled';
        const updated = await repo.updateWithVersion(tx, id, current.version, {
          status,
          ...(isCancel
            ? {
                cancellationReason: reason ?? null,
                cancelledBy: principal?.userId ?? null,
                cancelledAt: new Date(),
              }
            : {}),
        });
        if (updated === undefined) return { conflict: true as const };

        await repo.insertHistory(tx, {
          tenantId: this.tx.tenantId,
          appointmentId: id,
          actorUserId: principal?.userId ?? null,
          action: isCancel ? 'cancelled' : 'status_changed',
          fromStatus: current.status,
          toStatus: status,
          reason: reason ?? null,
        });

        // Randevu artık hatırlatma hak etmiyorsa bekleyen planlar kapanır.
        // Kuyruktaki iş İPTAL EDİLMEZ; zamanı gelince koşar, satırı `pending`
        // bulamaz ve sessizce çıkar (bkz. ReminderWorker).
        if (status !== 'scheduled' && status !== 'confirmed') {
          await this.reminders.cancelForAppointment(tx, id);
        }
        if (status === 'no_show') {
          await this.reminders.scheduleNoShowFollowup(tx, {
            tenantId: this.tx.tenantId,
            appointmentId: id,
            branchId: current.branchId,
            startsAt: current.startsAt,
          });
        }

        // Paket tüketimi AYNI transaction'da. Atomiklik ayrı bir mekanizma
        // değil, burada olmalarının doğal sonucu: hak yetersizse ya da paket
        // süresi dolmuşsa trigger hata fırlatır, transaction düşer ve randevu
        // tamamlanmaz (5.3 kabul kriteri).
        if (status === 'completed') {
          const actor = AppointmentsService.requireLedgerActor(principal);
          await this.consumption.consumeForAppointment(tx, {
            tenantId: this.tx.tenantId,
            appointmentId: id,
            actorUserId: actor,
          });
          // Borç da AYNI transaction'da doğar (6.1). Paketten karşılanan
          // kalemler atlanır: o borç paket satıldığında zaten doğdu.
          await this.chargeGeneration.generateForAppointment(tx, {
            tenantId: this.tx.tenantId,
            appointmentId: id,
            actorUserId: actor,
          });
          // Prim de aynı transaction'da tahakkuk eder (6.4). Kural yoksa
          // sessizce hiçbir şey yazılmaz.
          await this.commissions.accrueForAppointment(tx, {
            tenantId: this.tx.tenantId,
            appointmentId: id,
            actorUserId: actor,
          });
        } else if (current.status === 'completed') {
          const actor = AppointmentsService.requireLedgerActor(principal);
          await this.consumption.reverseForAppointment(tx, {
            tenantId: this.tx.tenantId,
            appointmentId: id,
            actorUserId: actor,
            reason,
          });
          // Sıra ÖNEMLİ: prim ters kaydı, ücret kalemleri `void` edilmeden
          // ÖNCE yazılır — ters kayıt hangi kalemlerin primlendiğini o
          // kalemler üzerinden bulur.
          await this.commissions.reverse(tx, {
            tenantId: this.tx.tenantId,
            actorUserId: actor,
            reason: reason ?? 'Randevu tamamlaması geri alındı',
            chargeIds: await this.chargeGeneration.openChargeIdsForAppointment(tx, id),
          });
          await this.chargeGeneration.voidForAppointment(tx, {
            appointmentId: id,
            actorUserId: actor,
            reason,
          });
        }

        const services = await repo.listAppointmentServices(tx, id);
        return { appointment: updated, services };
      })
      .catch((error: unknown) => {
        const translated = CustomerPackagesService.translate(error);
        if (translated !== error) throw translated;
        const financeTranslated = ChargesService.translate(error);
        if (financeTranslated !== error) throw financeTranslated;
        const commissionTranslated = CommissionsService.translate(error);
        if (commissionTranslated !== error) throw commissionTranslated;
        if (isPgError(error, PG_ERROR.INVALID_STATUS_TRANSITION)) {
          throw new AppError(
            409,
            ERROR_CODES.INVALID_STATUS_TRANSITION,
            'Geçersiz randevu durum geçişi',
          );
        }
        throw error;
      });

    if (payload === undefined) throw AppError.notFound('Randevu bulunamadı');
    if ('conflict' in payload) throw AppointmentsService.versionConflict();
    return this.present(payload.appointment, payload.services);
  }

  // ---------------------------------------------------------------------------
  // Planlama
  // ---------------------------------------------------------------------------
  /**
   * Hizmet dizisini somut zaman aralıklarına çevirir.
   *
   * Zincir: ilk hizmetin hazırlık payı bloğun ÖNÜNE, son hizmetin temizlik payı
   * ARKASINA düşer; aradaki hizmetlerde önceki temizlik + sonraki hazırlık
   * ardışık uygulanır. Fiyat ve süre burada SNAPSHOT alınır — katalog
   * sonradan değişse de randevunun tutarı değişmez.
   */
  private async buildPlan(
    tx: Tx,
    branchId: string,
    startsAt: Date,
    entries: AppointmentServiceInputDto[],
  ): Promise<Plan> {
    const definitions = await repo.resolveServiceDefinitions(tx, branchId, entries);
    const byPair = new Map(
      definitions.map((row) => [`${row.service_id}|${row.staff_profile_id}`, row]),
    );

    const services: PlannedService[] = [];
    let cursor = startsAt;
    let previousBufferAfter = 0;

    for (const [index, entry] of entries.entries()) {
      const definition = byPair.get(`${entry.serviceId}|${entry.staffProfileId}`);
      if (definition === undefined) {
        throw AppError.notFound('Hizmet bulunamadı veya pasif');
      }
      if (!definition.competent) {
        throw new AppError(
          422,
          ERROR_CODES.RESOURCE_UNAVAILABLE,
          'Seçilen personel bu hizmette yetkin değil',
        );
      }

      const bufferBefore = definition.buffer_before_minutes;
      const bufferAfter = definition.buffer_after_minutes;
      if (index > 0) {
        cursor = AppointmentsService.addMinutes(cursor, previousBufferAfter + bufferBefore);
      }

      const visibleStart = cursor;
      const visibleEnd = AppointmentsService.addMinutes(visibleStart, definition.duration_minutes);

      services.push({
        serviceId: entry.serviceId,
        staffProfileId: entry.staffProfileId,
        sortOrder: index,
        visibleStart,
        visibleEnd,
        occupiedStart: AppointmentsService.addMinutes(visibleStart, -bufferBefore),
        occupiedEnd: AppointmentsService.addMinutes(visibleEnd, bufferAfter),
        durationMinutes: definition.duration_minutes,
        bufferBeforeMinutes: bufferBefore,
        bufferAfterMinutes: bufferAfter,
        priceMinor: Number(definition.price_minor),
        vatRateBasisPoints: definition.vat_rate_basis_points,
        customerPackageItemId: entry.customerPackageItemId ?? null,
      });

      cursor = visibleEnd;
      previousBufferAfter = bufferAfter;
    }

    const first = services[0];
    const last = services.at(-1);
    if (first === undefined || last === undefined) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'En az bir hizmet gerekli');
    }

    // Aynı personelin birden çok kalemi TEK aralıkta birleşir: iki ayrı satır
    // yazmak, aralarındaki boşluğu başka bir randevuya açık bırakırdı.
    const spans = new Map<string, { from: Date; to: Date }>();
    for (const service of services) {
      const existing = spans.get(service.staffProfileId);
      if (existing === undefined) {
        spans.set(service.staffProfileId, {
          from: service.occupiedStart,
          to: service.occupiedEnd,
        });
        continue;
      }
      if (service.occupiedStart < existing.from) existing.from = service.occupiedStart;
      if (service.occupiedEnd > existing.to) existing.to = service.occupiedEnd;
    }

    return {
      services,
      visibleStart: first.visibleStart,
      visibleEnd: last.visibleEnd,
      staffSpans: [...spans].map(([staffProfileId, span]) => ({ staffProfileId, ...span })),
    };
  }

  private async writePlan(
    tx: Tx,
    appointmentId: string,
    branchId: string,
    customerId: string,
    plan: Plan,
  ): Promise<void> {
    await repo.insertAppointmentServices(
      tx,
      plan.services.map((service) => ({
        tenantId: this.tx.tenantId,
        appointmentId,
        serviceId: service.serviceId,
        staffProfileId: service.staffProfileId,
        sortOrder: service.sortOrder,
        startsAt: service.visibleStart,
        endsAt: service.visibleEnd,
        durationMinutes: service.durationMinutes,
        bufferBeforeMinutes: service.bufferBeforeMinutes,
        bufferAfterMinutes: service.bufferAfterMinutes,
        priceMinor: service.priceMinor,
        vatRateBasisPoints: service.vatRateBasisPoints,
        customerPackageItemId: service.customerPackageItemId,
      })),
    );

    for (const span of plan.staffSpans) {
      await repo.insertResourceBooking(tx, {
        tenantId: this.tx.tenantId,
        branchId,
        staffProfileId: span.staffProfileId,
        appointmentId,
        from: span.from,
        to: span.to,
      });
    }

    // Müşterinin kendi çakışması kiracıya göre değişen bir kuraldır; satır
    // yalnız ayar açıkken yazılır (bkz. 4.2).
    const settings = await settingsRepo.getBookingSettings(tx, this.tx.tenantId);
    if (settings?.preventCustomerDoubleBooking === true) {
      await repo.insertCustomerBooking(tx, {
        tenantId: this.tx.tenantId,
        customerId,
        appointmentId,
        from: plan.visibleStart,
        to: plan.visibleEnd,
      });
    }
  }

  private static async assertSchedule(tx: Tx, branchId: string, plan: Plan): Promise<void> {
    for (const service of plan.services) {
      const check = await repo.checkSchedule(tx, {
        branchId,
        staffProfileId: service.staffProfileId,
        visibleStart: service.visibleStart,
        visibleEnd: service.visibleEnd,
        occupiedStart: service.occupiedStart,
        occupiedEnd: service.occupiedEnd,
      });

      if (check === undefined || !check.branch_ok) {
        throw new AppError(
          422,
          ERROR_CODES.OUTSIDE_WORKING_HOURS,
          'Seçilen saat şubenin çalışma saatleri dışında',
        );
      }
      if (!check.staff_ok) {
        throw new AppError(
          422,
          ERROR_CODES.OUTSIDE_WORKING_HOURS,
          'Personel bu saatte çalışmıyor',
        );
      }
      if (!check.exception_free) {
        throw new AppError(
          422,
          ERROR_CODES.RESOURCE_UNAVAILABLE,
          'Personelin bu saatte izin/istisna kaydı var',
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Hata çevirisi
  // ---------------------------------------------------------------------------
  /**
   * Yazım hatalarını sözleşmedeki kodlara çevirir.
   *
   * `23P01` (exclusion_violation) burada 409 SLOT_CONFLICT'e dönüşür ve gövdeye
   * HANGİ kaynağın HANGİ aralıkta dolu olduğu + en yakın alternatif slotlar
   * eklenir: istemcinin kullanıcıya "dolu" demekten fazlasını söyleyebilmesi
   * için.
   */
  private async translateWrite(
    error: unknown,
    branchId: string,
    startsAt: Date,
    entries: AppointmentServiceInputDto[],
  ): Promise<never> {
    // Paket bağlama ve defter hataları TEK yerde çevriliyor; randevu tarafının
    // aynı eşlemeyi ikinci kez yazması, ikisinin bir gün ayrışması demekti.
    const packageError = CustomerPackagesService.translate(error);
    if (packageError !== error) throw packageError;

    if (isPgError(error, PG_ERROR.EXCLUSION_VIOLATION)) {
      throw await this.slotConflict(branchId, startsAt, entries);
    }
    if (isPgError(error, PG_ERROR.STAFF_NOT_COMPETENT)) {
      throw new AppError(
        422,
        ERROR_CODES.RESOURCE_UNAVAILABLE,
        'Seçilen personel bu hizmette yetkin değil',
      );
    }
    if (isPgError(error, PG_ERROR.INACTIVE_SERVICE)) {
      throw new AppError(
        422,
        ERROR_CODES.RESOURCE_UNAVAILABLE,
        'Pasif hizmet veya pasif personel ile randevu oluşturulamaz',
      );
    }
    if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
      throw AppError.notFound('Müşteri, şube, hizmet veya personel bulunamadı');
    }
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      throw AppError.conflict(
        ERROR_CODES.CONFLICT,
        'Randevu kayıtları bu kiracıya ait olmalı',
      );
    }
    throw error;
  }

  private async slotConflict(
    branchId: string,
    startsAt: Date,
    entries: AppointmentServiceInputDto[],
  ): Promise<AppError> {
    // Çakışma detayı AYRI bir transaction'da okunur: çakışmayı fırlatan
    // transaction iptal olmuştur, içinde başka sorgu koşturulamaz.
    const conflicts = await this.tx
      .run(async (tx) => {
        const plan = await this.buildPlan(tx, branchId, startsAt, entries);
        return repo.findConflicts(tx, plan.staffSpans);
      })
      .catch(() => []);

    const suggestions = await this.suggestAlternatives(branchId, startsAt, entries).catch(() => []);

    return AppError.conflict(ERROR_CODES.SLOT_CONFLICT, 'Seçilen saat dolu', {
      detail: 'Kaynak bu aralıkta başka bir kayıt tarafından tutuluyor.',
      extra: {
        conflicts: conflicts.map((row) => ({
          resourceType: 'staff',
          resourceId: row.resource_id,
          appointmentId: row.appointment_id,
          from: new Date(row.from_at).toISOString(),
          to: new Date(row.to_at).toISOString(),
        })),
        suggestions,
      },
    });
  }

  /** Aynı gün içindeki en yakın alternatifler — uygunluk motorundan. */
  private async suggestAlternatives(
    branchId: string,
    startsAt: Date,
    entries: AppointmentServiceInputDto[],
  ): Promise<{ startsAt: string; endsAt: string; staffProfileIds: string[] }[]> {
    const staffIds = new Set(entries.map((entry) => entry.staffProfileId));
    const dayStart = new Date(startsAt.getTime() - 12 * 60 * 60 * 1000);
    const dayEnd = new Date(startsAt.getTime() + 12 * 60 * 60 * 1000);

    const result = await this.availability.computeSlots(
      {
        branchId,
        serviceIds: entries.map((entry) => entry.serviceId),
        from: dayStart.toISOString(),
        to: dayEnd.toISOString(),
        ...(staffIds.size === 1 ? { staffProfileId: [...staffIds][0] } : {}),
      },
      new Date(Math.min(Date.now(), dayStart.getTime())),
    );

    return result.slots
      .map((slot) => ({
        slot,
        distance: Math.abs(new Date(slot.startsAt).getTime() - startsAt.getTime()),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, SUGGESTION_LIMIT)
      .map(({ slot }) => slot);
  }

  // ---------------------------------------------------------------------------
  // Yardımcılar
  // ---------------------------------------------------------------------------
  /**
   * `practitioner` varsayılan olarak yalnız KENDİ randevularını görür.
   *
   * Başkasının randevusu 403 değil 404 döner: 403, "bu kayıt var ama sana
   * kapalı" bilgisini sızdırırdı.
   */
  private async assertVisible(
    principal: Principal,
    services: repo.AppointmentServiceRow[],
  ): Promise<void> {
    if (hasPermission(principal, PERMISSIONS.APPOINTMENT_READ_ALL)) return;

    const ownProfileId = await this.tx.run((tx) =>
      repo.findStaffProfileIdByUser(tx, principal.userId),
    );
    if (ownProfileId !== undefined && services.some((row) => row.staffProfileId === ownProfileId)) {
      return;
    }
    throw AppError.notFound('Randevu bulunamadı');
  }

  private static assertMutable(status: AppointmentStatus): void {
    if (status === 'cancelled' || status === 'no_show' || status === 'completed') {
      throw AppError.conflict(
        ERROR_CODES.INVALID_STATUS_TRANSITION,
        `Bu randevu ${status} durumunda; ertelenemez`,
      );
    }
  }

  private static versionConflict(): AppError {
    return AppError.conflict(ERROR_CODES.VERSION_CONFLICT, 'Kayıt siz okuduktan sonra değişti', {
      detail: 'Kaydı yeniden okuyup değişikliği tekrar uygulayın.',
    });
  }

  /**
   * Defter yazan geçişlerin AKTÖRÜ.
   *
   * Paket tüketimi, borç ve prim satırları "kim yaptı" bilgisini taşımak
   * zorunda; aktörsüz bir tamamlama, denetim kaydında sahibi olmayan bir
   * finansal hareket demekti. Self-servis yolu (Batch 9.5) zaten yalnız iptal
   * ve erteleme yapıyor — bu kontrol o sözleşmenin kodla ifade edilmiş hâli.
   */
  private static requireLedgerActor(principal: Principal | null): string {
    if (principal === null) {
      throw AppError.forbidden('Bu durum değişikliği self-servis olarak yapılamaz');
    }
    return principal.userId;
  }

  private static parseInstant(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Başlangıç zamanı geçersiz');
    }
    return parsed;
  }

  private static addMinutes(instant: Date, minutes: number): Date {
    return new Date(instant.getTime() + minutes * 60_000);
  }

  private async present(
    appointment: repo.AppointmentRow,
    services: repo.AppointmentServiceRow[],
  ): Promise<AppointmentResponseDto> {
    const branch = await this.tx.run((tx) =>
      settingsRepo.findBranchForBooking(tx, appointment.branchId),
    );
    const timezone = branch?.timezone ?? 'UTC';

    return {
      id: appointment.id,
      tenantId: appointment.tenantId,
      branchId: appointment.branchId,
      customerId: appointment.customerId,
      status: appointment.status,
      startsAt: toZonedIso(appointment.startsAt, timezone),
      endsAt: toZonedIso(appointment.endsAt, timezone),
      origin: appointment.origin,
      notes: appointment.notes,
      cancellationReason: appointment.cancellationReason,
      version: appointment.version,
      totalMinor: services.reduce((sum, row) => sum + Number(row.priceMinor), 0),
      createdAt: appointment.createdAt.toISOString(),
      services: services.map((row) =>
        AppointmentsService.toServiceResponse(row, timezone),
      ),
    };
  }

  private static toServiceResponse(
    row: repo.AppointmentServiceRow,
    timezone: string,
  ): AppointmentServiceResponseDto {
    return {
      id: row.id,
      serviceId: row.serviceId,
      staffProfileId: row.staffProfileId,
      sortOrder: row.sortOrder,
      startsAt: toZonedIso(row.startsAt, timezone),
      endsAt: toZonedIso(row.endsAt, timezone),
      durationMinutes: row.durationMinutes,
      bufferBeforeMinutes: row.bufferBeforeMinutes,
      bufferAfterMinutes: row.bufferAfterMinutes,
      priceMinor: Number(row.priceMinor),
      vatRateBasisPoints: row.vatRateBasisPoints,
      customerPackageItemId: row.customerPackageItemId,
    };
  }
}
