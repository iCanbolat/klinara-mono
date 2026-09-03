import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic, weeklyStaffSchedule, type ClinicFixture } from '../helpers/clinic';

const ROOT_DOMAIN = 'klinara.localhost';
const MONDAY = '2026-09-07';
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface StaffOption {
  staffRef: string;
  name: string;
  title: string | null;
}
interface SlotBody {
  slotToken: string;
  staffName?: string;
  staffRef?: string;
}
interface AvailabilityBody {
  slots: SlotBody[];
}
interface Problem {
  code: string;
}

/**
 * Ek C — uygulayıcı seçimi.
 *
 * Faz 9 slot ızgarasında İLK adayı seçip yalnız adını gösteriyordu; müşteri
 * uygulayıcı SEÇEMİYORDU. Bu testler o ucun üç sözünü sınıyor: liste doğru
 * süzülüyor, referans opak ve kalıcı, ve süzme gerçekten o kişiye daraltıyor.
 */
describe('public uygulayıcı seçimi (Ek C)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
        PUBLIC_BOOKING_DOMAIN: ROOT_DOMAIN,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    clinic = await setupClinic(app, { slug: 'klinik-x' });
    await publishSite();
  });

  const ownerAuth = () => auth(clinic.owner.tokens);

  async function publishSite(): Promise<void> {
    await http(app)
      .put('/api/v1/booking-page/content')
      .set(ownerAuth())
      .set('If-Match', 'W/"0"')
      .send({ sections: [{ type: 'hero', title: 'Klinik X' }] })
      .expect(200);
    await http(app).post('/api/v1/booking-page/publish').set(ownerAuth()).expect(200);
  }

  const askStaff = (overrides: Record<string, string> = {}) =>
    http(app)
      .get('/api/v1/public/sites/klinik-x/staff')
      .query({
        branchId: clinic.branch.id,
        serviceIds: clinic.quickService.id,
        ...overrides,
      });

  const askSlots = (overrides: Record<string, string> = {}) =>
    http(app)
      .get('/api/v1/public/sites/klinik-x/availability')
      .query({
        branchId: clinic.branch.id,
        serviceIds: clinic.quickService.id,
        from: `${MONDAY}T00:00:00+03:00`,
        to: `${MONDAY}T23:59:00+03:00`,
        ...overrides,
      });

  /** İkinci bir uygulayıcı — görünürlüğü ve yetkinliği çağrı yerine göre ayarlanır. */
  async function addPractitioner(options: {
    email: string;
    fullName: string;
    visibleOnline: boolean;
    serviceIds: string[];
  }): Promise<string> {
    const member = await inviteMember(app, clinic.owner.tokens, {
      email: options.email,
      roleKey: 'practitioner',
      branchId: clinic.branch.id,
      fullName: options.fullName,
    });
    const created = await http(app)
      .post('/api/v1/staff')
      .set(ownerAuth())
      .send({
        userId: member.userId,
        primaryBranchId: clinic.branch.id,
        title: 'Uzman',
        isVisibleOnline: options.visibleOnline,
        services: options.serviceIds.map((serviceId) => ({
          serviceId,
          branchId: clinic.branch.id,
        })),
      })
      .expect(201);
    const staffId = (created.body as { id: string }).id;
    expect((created.body as { isVisibleOnline: boolean }).isVisibleOnline).toBe(
      options.visibleOnline,
    );

    await http(app)
      .put(`/api/v1/staff/${staffId}/schedule`)
      .set(ownerAuth())
      .set({ 'x-branch-id': clinic.branch.id })
      .send({ branchId: clinic.branch.id, entries: weeklyStaffSchedule() })
      .expect(200);
    return staffId;
  }

  it('KRİTİK: yanıtta HİÇBİR UUID yok', async () => {
    const res = await askStaff().expect(200);
    const body = res.body as StaffOption[];
    expect(body.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(UUID_PATTERN);
  });

  it('is_visible_online kapalı uygulayıcı listede YOK', async () => {
    await addPractitioner({
      email: 'gizli@klinik-x.test',
      fullName: 'Gizli Uygulayıcı',
      visibleOnline: false,
      serviceIds: [clinic.quickService.id],
    });

    const res = await askStaff().expect(200);
    const names = (res.body as StaffOption[]).map((s) => s.name);
    expect(names).toContain('Demo Uygulayıcı');
    expect(names).not.toContain('Gizli Uygulayıcı');
  });

  it('istenen hizmetlerin HEPSİNDE yetkin olmayan düşer', async () => {
    await addPractitioner({
      email: 'yarim@klinik-x.test',
      fullName: 'Yarım Yetkin',
      visibleOnline: true,
      serviceIds: [clinic.quickService.id],
    });

    // Tek hizmette ikisi de var…
    const one = await askStaff().expect(200);
    expect((one.body as StaffOption[]).map((s) => s.name)).toEqual(
      expect.arrayContaining(['Demo Uygulayıcı', 'Yarım Yetkin']),
    );

    // …iki hizmet istendiğinde yalnız ikisini de yapabilen kalır.
    const both = await askStaff({
      serviceIds: `${clinic.quickService.id},${clinic.service.id}`,
    }).expect(200);
    const names = (both.body as StaffOption[]).map((s) => s.name);
    expect(names).toContain('Demo Uygulayıcı');
    expect(names).not.toContain('Yarım Yetkin');
  });

  it('staffRef DETERMİNİSTİK — iki çağrıda aynı değer', async () => {
    // Kalıcılık şart: ref bir URL parametresi ve cache anahtarı parçası.
    const first = (await askStaff().expect(200)).body as StaffOption[];
    const second = (await askStaff().expect(200)).body as StaffOption[];
    expect(first[0]!.staffRef).toBe(second[0]!.staffRef);
    expect(first[0]!.staffRef).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('uygunluk yanıtındaki staffRef, /staff listesindekiyle AYNI', async () => {
    const staff = (await askStaff().expect(200)).body as StaffOption[];
    const slots = (await askSlots().expect(200)).body as AvailabilityBody;
    const refs = new Set(staff.map((s) => s.staffRef));
    expect(slots.slots[0]!.staffRef).toBeDefined();
    expect(refs.has(slots.slots[0]!.staffRef!)).toBe(true);
  });

  it('staffRef ile süzülen uygunluk, süzülmemişin ALT KÜMESİ', async () => {
    const staff = (await askStaff().expect(200)).body as StaffOption[];
    const all = (await askSlots().expect(200)).body as AvailabilityBody;
    const filtered = (await askSlots({ staffRef: staff[0]!.staffRef }).expect(200))
      .body as AvailabilityBody;

    expect(filtered.slots.length).toBeGreaterThan(0);
    expect(filtered.slots.length).toBeLessThanOrEqual(all.slots.length);
    for (const slot of filtered.slots) {
      expect(slot.staffRef).toBe(staff[0]!.staffRef);
    }
  });

  it('geçersiz staffRef 404 STAFF_REF_INVALID, biçimsiz olan 400', async () => {
    const notFound = await askSlots({ staffRef: 'A'.repeat(22) }).expect(404);
    expect((notFound.body as Problem).code).toBe('STAFF_REF_INVALID');

    // Biçim doğrulaması guard'dan önce: kısa girdi motora hiç ulaşmaz.
    await askSlots({ staffRef: 'kisa' }).expect(400);
  });

  it('BAŞKA KİRACININ ref’i çözülmez', async () => {
    const staff = (await askStaff().expect(200)).body as StaffOption[];
    const other = await setupClinic(app, { slug: 'klinik-y' });
    await http(app)
      .put('/api/v1/booking-page/content')
      .set(auth(other.owner.tokens))
      .set('If-Match', 'W/"0"')
      .send({ sections: [{ type: 'hero', title: 'Klinik Y' }] })
      .expect(200);
    await http(app).post('/api/v1/booking-page/publish').set(auth(other.owner.tokens)).expect(200);

    const res = await http(app)
      .get('/api/v1/public/sites/klinik-y/availability')
      .query({
        branchId: other.branch.id,
        serviceIds: other.quickService.id,
        from: `${MONDAY}T00:00:00+03:00`,
        to: `${MONDAY}T23:59:00+03:00`,
        staffRef: staff[0]!.staffRef,
      })
      .expect(404);
    expect((res.body as Problem).code).toBe('STAFF_REF_INVALID');
  });

  it('showStaffSelection kapalıyken liste BOŞ ve staffRef yok sayılır', async () => {
    const staff = (await askStaff().expect(200)).body as StaffOption[];
    await http(app)
      .put('/api/v1/booking-page')
      .set(ownerAuth())
      .send({ showStaffSelection: false })
      .expect(200);

    expect((await askStaff().expect(200)).body).toEqual([]);

    // Eski bir bağlantıyla gelen ziyaretçi hata görmemeli; slotlar dönmeye
    // devam eder ama personel bilgisi taşımaz.
    const slots = (await askSlots({ staffRef: staff[0]!.staffRef }).expect(200))
      .body as AvailabilityBody;
    expect(slots.slots.length).toBeGreaterThan(0);
    expect(slots.slots[0]!.staffRef).toBeUndefined();
    expect(slots.slots[0]!.staffName).toBeUndefined();
  });
});
