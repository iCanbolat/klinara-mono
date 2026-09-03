import type { NestExpressApplication } from '@nestjs/platform-express';
import { describeResponse } from './describe-response';
import { auth, bootstrapTenant, http, inviteMember, type TenantFixture, type Tokens } from './identity';

/**
 * Klinik fixture'ı — Faz 2 ve Faz 3 testlerinin ortak zemini.
 *
 * "Kategori → hizmet → personel → yetkinlik → çalışma saatleri" zinciri her
 * takvim testinin ön koşuludur. Zinciri her dosyada elle kurmak yerine burada
 * BİR kez kuruyoruz: bir uç değiştiğinde düzeltilecek tek yer olur.
 *
 * ⚠️ `dayOfWeek` konvansiyonu PostgreSQL `extract(dow …)` ile aynıdır:
 * 0 = Pazar … 6 = Cumartesi. Uygunluk motoru da aynı ifadeyi kullandığı için
 * fixture ile sorgu arasında dönüşüm yoktur.
 */

export const SUNDAY = 0;
export const SATURDAY = 6;

/** Şube kapsamlı uçlar `X-Branch-Id` ZORUNLU ister (`@RequireBranchScope`). */
export const branchHeader = (branchId: string) => ({ 'x-branch-id': branchId });

export interface ServiceBody {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceMinor: number;
  isActive: boolean;
  branchOverrides: { branchId: string; durationMinutes: number | null; priceMinor: number | null }[];
}

export interface StaffBody {
  id: string;
  userId: string;
  services: { serviceId: string; branchId: string | null }[];
}

export interface CustomerBody {
  id: string;
  fullName: string;
  phone: string | null;
}

export interface ClinicFixture extends TenantFixture {
  category: { id: string; slug: string };
  /** 60 dk + 5 dk hazırlık + 10 dk temizlik — buffer davranışını sınamak için. */
  service: ServiceBody;
  /** 30 dk, buffer'sız — sırt sırta randevu senaryoları için. */
  quickService: ServiceBody;
  practitioner: { userId: string; tokens: Tokens; staffProfileId: string };
  customer: CustomerBody;
}

interface WeeklyHour {
  dayOfWeek: number;
  isClosed?: boolean;
  openTime?: string;
  closeTime?: string;
  breakStartTime?: string;
  breakEndTime?: string;
}

/** Hafta içi açık, Pazar kapalı bir şube takvimi üretir. */
export function weeklyBranchHours(
  options: {
    openTime?: string;
    closeTime?: string;
    breakStartTime?: string;
    breakEndTime?: string;
    closedDays?: number[];
  } = {},
): WeeklyHour[] {
  const openTime = options.openTime ?? '09:00';
  const closeTime = options.closeTime ?? '18:00';
  const closedDays = options.closedDays ?? [SUNDAY];

  return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
    if (closedDays.includes(dayOfWeek)) return { dayOfWeek, isClosed: true };
    return {
      dayOfWeek,
      isClosed: false,
      openTime,
      closeTime,
      ...(options.breakStartTime !== undefined && options.breakEndTime !== undefined
        ? { breakStartTime: options.breakStartTime, breakEndTime: options.breakEndTime }
        : {}),
    };
  });
}

/** Personel haftalık şablonu; kapalı günlerde `isOff`. */
export function weeklyStaffSchedule(
  options: { startTime?: string; endTime?: string; offDays?: number[] } = {},
): { dayOfWeek: number; isOff?: boolean; startTime?: string; endTime?: string }[] {
  const startTime = options.startTime ?? '09:00';
  const endTime = options.endTime ?? '18:00';
  const offDays = options.offDays ?? [SUNDAY];

  return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) =>
    offDays.includes(dayOfWeek)
      ? { dayOfWeek, isOff: true }
      : { dayOfWeek, isOff: false, startTime, endTime },
  );
}

/** Fixture adımının beklenen durumu döndüğünü doğrular. */
async function expectOk<T>(
  promise: Promise<{ status: number; body: unknown }>,
  expected: number,
  what: string,
): Promise<T> {
  const res = await promise;
  if (res.status !== expected) {
    throw new Error(`${what} başarısız: ${res.status} ${JSON.stringify(res.body)} ${describeResponse(res)}`);
  }
  return res.body as T;
}

export interface SetupClinicOptions {
  slug?: string;
  timezone?: string;
  branchHours?: WeeklyHour[];
  staffSchedule?: ReturnType<typeof weeklyStaffSchedule>;
}

/**
 * Giriş yapılabilir bir kiracı + tam kurulmuş bir klinik döner.
 *
 * Her adım GERÇEK HTTP ucundan geçer; doğrudan veritabanına yazmıyoruz. Böylece
 * fixture aynı zamanda uçların birlikte çalıştığının kanıtı olur.
 */
export async function setupClinic(
  app: NestExpressApplication,
  options: SetupClinicOptions = {},
): Promise<ClinicFixture> {
  const slug = options.slug ?? 'demo-klinik';
  const tenant = await bootstrapTenant(app, { slug });
  const ownerAuth = auth(tenant.owner.tokens);
  const branch = branchHeader(tenant.branch.id);

  const category = await expectOk<{ id: string; slug: string }>(
    http(app)
      .post('/api/v1/service-categories')
      .set(ownerAuth)
      .send({ slug: 'epilasyon', name: 'Epilasyon' }),
    201,
    'Kategori oluşturma',
  );

  const service = await expectOk<ServiceBody>(
    http(app).post('/api/v1/services').set(ownerAuth).send({
      categoryId: category.id,
      slug: 'tum-vucut-lazer',
      name: 'Tüm Vücut Lazer',
      durationMinutes: 60,
      bufferBeforeMinutes: 5,
      bufferAfterMinutes: 10,
      priceMinor: 150000,
    }),
    201,
    'Hizmet oluşturma',
  );

  const quickService = await expectOk<ServiceBody>(
    http(app).post('/api/v1/services').set(ownerAuth).send({
      categoryId: category.id,
      slug: 'bolgesel-lazer',
      name: 'Bölgesel Lazer',
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      priceMinor: 50000,
    }),
    201,
    'Hızlı hizmet oluşturma',
  );

  const member = await inviteMember(app, tenant.owner.tokens, {
    email: `uygulayici@${slug}.test`,
    roleKey: 'practitioner',
    branchId: tenant.branch.id,
    fullName: 'Demo Uygulayıcı',
  });

  const staff = await expectOk<StaffBody>(
    http(app)
      .post('/api/v1/staff')
      .set(ownerAuth)
      .send({
        userId: member.userId,
        primaryBranchId: tenant.branch.id,
        title: 'Lazer Uzmanı',
        services: [
          { serviceId: service.id, branchId: tenant.branch.id },
          { serviceId: quickService.id, branchId: tenant.branch.id },
        ],
      }),
    201,
    'Personel profili oluşturma',
  );

  await expectOk(
    http(app)
      .put(`/api/v1/branches/${tenant.branch.id}/hours`)
      .set(ownerAuth)
      .set(branch)
      .send({ entries: options.branchHours ?? weeklyBranchHours() }),
    200,
    'Şube çalışma saatleri',
  );

  await expectOk(
    http(app)
      .put(`/api/v1/staff/${staff.id}/schedule`)
      .set(ownerAuth)
      .set(branch)
      .send({
        branchId: tenant.branch.id,
        entries: options.staffSchedule ?? weeklyStaffSchedule(),
      }),
    200,
    'Personel haftalık şablonu',
  );

  const customer = await expectOk<CustomerBody>(
    http(app)
      .post('/api/v1/customers')
      .set(ownerAuth)
      .send({ fullName: 'Ayşe Yılmaz', phone: '0532 123 45 67', email: 'ayse@ornek.test' }),
    201,
    'Müşteri oluşturma',
  );

  return {
    ...tenant,
    category,
    service,
    quickService,
    practitioner: { userId: member.userId, tokens: member.tokens, staffProfileId: staff.id },
    customer,
  };
}
