import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { TenantTxService } from '../../database/tenant-tx.service';
import { AvailabilityService } from '../booking/availability.service';
import * as pageRepo from '../booking-page/booking-page.repository';
import { SlotTokenService } from './slot-token.service';
import type { Tx } from '../../database/tenant-tx';
import type { PublicSiteContext } from './public-site-resolver.service';

/** Public pencere üst sınırı — motorun kendi 31 günlük sınırıyla aynı. */
const MAX_PUBLIC_WINDOW_DAYS = 31;

export interface PublicSlotView {
  startsAt: string;
  endsAt: string;
  /** Slotun opak temsili. UUID YOK. */
  slotToken: string;
  /** `showStaffSelection` açıkken personelin ADI; kimliği asla. */
  staffName?: string;
}

export interface PublicAvailabilityView {
  timezone: string;
  slotGranularityMinutes: number;
  slots: PublicSlotView[];
}

/**
 * Faz 3 uygunluk motorunun public sarmalayıcısı.
 *
 * `AvailabilityService.computeSlots` DEĞİŞTİRİLMEDİ — motor iki kez yazılırsa
 * buffer, yetkinlik ve çalışma saati kuralları iki yolda ayrışır ve ayrışma
 * ancak üretimde fark edilir. Bu servisin yaptığı tek şey MASKELEME:
 * personel kimliklerini opak token'a gömmek ve site ayarlarını uygulamak.
 */
@Injectable()
export class PublicAvailabilityService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly availability: AvailabilityService,
    private readonly slotTokens: SlotTokenService,
  ) {}

  async findSlots(
    site: PublicSiteContext,
    query: { branchId: string; serviceIds: string[]; from: string; to: string },
    now: Date = new Date(),
  ): Promise<PublicAvailabilityView> {
    assertWindow(query.from, query.to);

    const settings = await this.tx.run((tx) => pageRepo.findSettings(tx, site.siteId));
    const showStaff = settings?.showStaffSelection ?? true;

    const response = await this.availability.computeSlots(
      {
        branchId: query.branchId,
        serviceIds: query.serviceIds,
        from: query.from,
        to: query.to,
      },
      now,
    );

    const staffNames = showStaff
      ? await this.tx.run((tx) => loadStaffNames(tx, response.slots.flatMap((s) => s.staffProfileIds)))
      : new Map<string, string>();

    return {
      timezone: response.timezone,
      slotGranularityMinutes: response.slotGranularityMinutes,
      slots: response.slots.map((slot) => {
        // Çok personelli bir slotta İLK aday seçiliyor ve token'a gömülüyor.
        // Seçimi randevu anına ertelemek, hold yazılırken aday kümesinin
        // değişmiş olabileceği (başka biri o personeli almış) anlamına gelirdi;
        // müşteri saati seçtiğinde kaynağın da belirlenmesi daha dürüst.
        const staffProfileId = slot.staffProfileIds[0] ?? '';
        const view: PublicSlotView = {
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          slotToken: this.slotTokens.issue(
            {
              tenantId: site.tenantId,
              branchId: query.branchId,
              serviceIds: query.serviceIds,
              staffProfileId,
              startsAt: slot.startsAt,
              endsAt: slot.endsAt,
            },
            now,
          ),
        };
        const name = staffNames.get(staffProfileId);
        if (showStaff && name !== undefined) view.staffName = name;
        return view;
      }),
    };
  }
}

function assertWindow(from: string, to: string): void {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Tarih aralığı geçersiz');
  }
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (days > MAX_PUBLIC_WINDOW_DAYS) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      `Sorgu en fazla ${MAX_PUBLIC_WINDOW_DAYS} gün olabilir`,
    );
  }
}

/**
 * Personel adları — yalnız `is_visible_online` açık olanlar.
 *
 * Bayrak `staff_profiles`ta Faz 2'den beri var ve public sayfanın onu
 * ONURLANDIRMASI gerekiyor: bir uygulayıcı takvimde çalışıyor ama adının
 * internette görünmesini istemiyor olabilir. Gizli personelin slotu YİNE
 * ÇIKAR, yalnız adı taşınmaz — aksi hâlde klinik kapasitesinin bir kısmını
 * online satamazdı.
 */
async function loadStaffNames(tx: Tx, staffProfileIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(staffProfileIds.filter((id) => id !== ''))];
  if (unique.length === 0) return new Map();

  const result = await tx.execute<{ id: string; display_name: string }>(sql`
    select sp.id, coalesce(nullif(trim(u.full_name), ''), sp.title, '') as display_name
      from staff_profiles sp
      join users u on u.id = sp.user_id
     where sp.id = any(string_to_array(${unique.join(',')}, ',')::uuid[])
       and sp.deleted_at is null
       and sp.is_visible_online = true
  `);

  return new Map(
    result.rows
      .filter((row) => row.display_name !== '')
      .map((row) => [row.id, row.display_name] as const),
  );
}
