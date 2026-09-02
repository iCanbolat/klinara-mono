import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@klinara/shared';
import { sha256 } from '../../common/crypto/tokens';
import { AppError } from '../../common/errors/app-error';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { AppointmentsService } from '../booking/appointments.service';
import * as pageRepo from '../booking-page/booking-page.repository';
import { loadTenantDefaults, resolveSettings } from '../booking-page/booking-page.service';
import { SlotTokenService } from './slot-token.service';
import type { PublicSiteContext } from './public-site-resolver.service';

/**
 * Self-servis bağlantısının açtığı görünüm.
 *
 * Alan listesi DAR ve kasıtlı: randevu saati, hizmet adları, şube adresi ve
 * klinik telefonu. Tıbbi not, geçmiş randevu, paket bakiyesi ve e-posta YOK.
 * Bu bir sunum tercihi değil, token'ın kapsamının kendisi — token bir
 * müşteriye değil TEK BİR RANDEVUYA bağlı, dolayısıyla "müşterinin geçmişini
 * de göster" diye bir genişleme yolu yok.
 */
export interface SelfServiceView {
  appointmentId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  serviceNames: string[];
  branchName: string;
  branchAddress: string | null;
  branchPhone: string | null;
  timezone: string;
  customerFirstName: string;
  canCancel: boolean;
  canReschedule: boolean;
  cancelWindowHours: number;
}

@Injectable()
export class SelfServiceService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly appointments: AppointmentsService,
    private readonly slotTokens: SlotTokenService,
  ) {}

  async view(
    site: PublicSiteContext,
    token: string,
    now: Date = new Date(),
  ): Promise<SelfServiceView> {
    const { appointment, settings } = await this.tx.run(async (tx) => {
      const row = await this.consumeToken(tx, token, now);
      return {
        appointment: row,
        settings: await this.resolveSiteSettings(tx, site),
      };
    });
    return present(appointment, settings, now);
  }

  async cancel(
    site: PublicSiteContext,
    token: string,
    reason: string | undefined,
    now: Date = new Date(),
  ): Promise<SelfServiceView> {
    const payload = await this.tx.run(async (tx) => {
      const row = await this.consumeToken(tx, token, now);
      const settings = await this.resolveSiteSettings(tx, site);
      assertCancelWindow(row.startsAt, settings.cancelWindowHours, now, row.branchPhone);
      return { row, settings };
    });

    await this.appointments.cancelUnauthorized(payload.row.appointmentId, reason);
    return this.view(site, token, now);
  }

  async reschedule(
    site: PublicSiteContext,
    token: string,
    slotToken: string,
    now: Date = new Date(),
  ): Promise<SelfServiceView> {
    const claim = this.slotTokens.verify(slotToken, site.tenantId, now);

    const payload = await this.tx.run(async (tx) => {
      const row = await this.consumeToken(tx, token, now);
      const settings = await this.resolveSiteSettings(tx, site);
      if (!settings.allowReschedule) {
        throw AppError.forbidden('Bu klinik online erteleme kabul etmiyor', {
          detail:
            row.branchPhone === null
              ? 'Lütfen kliniği arayın.'
              : `Lütfen kliniği arayın: ${row.branchPhone}`,
        });
      }
      assertCancelWindow(row.startsAt, settings.cancelWindowHours, now, row.branchPhone);
      return row;
    });

    // Erteleme, iptal + yeni randevu DEĞİL: aynı kaydın taşınması.
    await this.appointments.rescheduleUnauthorized(
      payload.appointmentId,
      claim.startsAt,
      'Müşteri self-servis ertelemesi',
    );
    return this.view(site, token, now);
  }

  /** Takvime ekle dosyası. Süreç içinde üretiliyor; bir kütüphane gerektirmiyor. */
  async ics(site: PublicSiteContext, token: string, now: Date = new Date()): Promise<string> {
    const view = await this.view(site, token, now);
    return buildIcs(view);
  }

  /**
   * Token'ı çözer, sayacı ARTIRIR ve randevuyu döner.
   *
   * Kullanım sayacı olmadan bir bağlantı, iletilmiş bir mesajdan sonsuza dek
   * erişilebilir kalırdı. Sayaç `where` içinde artırılıyor: eş zamanlı iki
   * istek sayacı bir kez atlayamaz.
   */
  private async consumeToken(tx: Tx, token: string, now: Date): Promise<AppointmentRow> {
    const result = await tx.execute<Record<string, unknown>>(sql`
      with claimed as (
        update booking_access_tokens
           set use_count = use_count + 1, last_used_at = ${now.toISOString()}::timestamptz,
               updated_at = now()
         where token_hash = ${sha256(token)}
           and revoked_at is null
           and expires_at > ${now.toISOString()}::timestamptz
           and use_count < max_uses
        returning appointment_id
      )
      select a.id            as appointment_id,
             a.status::text  as status,
             a.starts_at,
             a.ends_at,
             b.name          as branch_name,
             b.address       as branch_address,
             b.phone         as branch_phone,
             b.timezone      as timezone,
             split_part(c.full_name, ' ', 1) as customer_first_name,
             coalesce(
               (select array_agg(s.name order by asv.sort_order)
                  from appointment_services asv
                  join services s on s.id = asv.service_id
                 where asv.appointment_id = a.id),
               '{}'
             ) as service_names
        from claimed
        join appointments a on a.id = claimed.appointment_id
        join branches b     on b.id = a.branch_id
        join customers c    on c.id = a.customer_id
       limit 1
    `);

    const row = result.rows[0];
    if (row === undefined) {
      throw new AppError(404, ERROR_CODES.BOOKING_TOKEN_INVALID, 'Bağlantı geçersiz', {
        detail: 'Bağlantının süresi dolmuş ya da daha önce çok kez kullanılmış olabilir.',
      });
    }

    return {
      appointmentId: row['appointment_id'] as string,
      status: row['status'] as string,
      startsAt: new Date(row['starts_at'] as string),
      endsAt: new Date(row['ends_at'] as string),
      branchName: row['branch_name'] as string,
      branchAddress: (row['branch_address'] as string | null) ?? null,
      branchPhone: (row['branch_phone'] as string | null) ?? null,
      timezone: row['timezone'] as string,
      customerFirstName: (row['customer_first_name'] as string | null) ?? '',
      serviceNames: (row['service_names'] as string[] | null) ?? [],
    };
  }

  private async resolveSiteSettings(
    tx: Tx,
    site: PublicSiteContext,
  ): Promise<{ cancelWindowHours: number; allowReschedule: boolean }> {
    const settings = await pageRepo.findSettings(tx, site.siteId);
    const defaults = await loadTenantDefaults(tx);
    const resolved = resolveSettings(settings, defaults);
    return {
      cancelWindowHours: resolved.cancelWindowHours,
      allowReschedule: resolved.allowReschedule,
    };
  }
}

interface AppointmentRow {
  appointmentId: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  branchName: string;
  branchAddress: string | null;
  branchPhone: string | null;
  timezone: string;
  customerFirstName: string;
  serviceNames: string[];
}

/**
 * İptal penceresi.
 *
 * Kapalıysa müşteri kliniğe YÖNLENDİRİLİR — "yapamazsınız" demek, telefonla
 * halledilebilecek bir işlemi çıkmaza sokardı.
 */
function assertCancelWindow(
  startsAt: Date,
  windowHours: number,
  now: Date,
  branchPhone: string | null,
): void {
  const deadline = new Date(startsAt.getTime() - windowHours * 3_600_000);
  if (now >= deadline) {
    throw AppError.conflict(ERROR_CODES.CANCEL_WINDOW_CLOSED, 'İptal süresi doldu', {
      detail:
        branchPhone === null
          ? `Randevudan ${windowHours} saat öncesine kadar iptal edilebilir. Lütfen kliniği arayın.`
          : `Randevudan ${windowHours} saat öncesine kadar iptal edilebilir. Klinik: ${branchPhone}`,
    });
  }
}

function present(
  row: AppointmentRow,
  settings: { cancelWindowHours: number; allowReschedule: boolean },
  now: Date,
): SelfServiceView {
  const open = now < new Date(row.startsAt.getTime() - settings.cancelWindowHours * 3_600_000);
  const mutable = row.status === 'scheduled' || row.status === 'confirmed';
  return {
    appointmentId: row.appointmentId,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    serviceNames: row.serviceNames,
    branchName: row.branchName,
    branchAddress: row.branchAddress,
    branchPhone: row.branchPhone,
    timezone: row.timezone,
    customerFirstName: row.customerFirstName,
    canCancel: mutable && open,
    canReschedule: mutable && open && settings.allowReschedule,
    cancelWindowHours: settings.cancelWindowHours,
  };
}

/** RFC 5545 — takvim uygulamalarının ayrıştırabildiği en yalın biçim. */
function buildIcs(view: SelfServiceView): string {
  const stamp = (value: string): string =>
    new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  // Satır sonları CRLF olmak ZORUNDA; `\n` ile üretilen dosyayı bazı takvim
  // uygulamaları hiç açmıyor.
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Klinara//Randevu//TR',
    'BEGIN:VEVENT',
    `UID:${view.appointmentId}@klinara`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(view.startsAt)}`,
    `DTEND:${stamp(view.endsAt)}`,
    `SUMMARY:${escapeIcs(view.serviceNames.join(', ') || 'Randevu')} — ${escapeIcs(view.branchName)}`,
    ...(view.branchAddress === null ? [] : [`LOCATION:${escapeIcs(view.branchAddress)}`]),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function escapeIcs(value: string): string {
  return value.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
}
