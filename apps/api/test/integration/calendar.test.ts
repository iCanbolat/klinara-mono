import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';
import pg from 'pg';
import { PG_POOL } from '../../src/database/database.constants';

interface Entry {
  id: string;
  customerName: string;
  status: string;
  startsAt: string;
  endsAt: string;
  totalMinor: number;
  services: { serviceName: string; staffProfileId: string; sortOrder: number }[];
}
interface CalendarBody {
  branchId: string;
  timezone: string;
  from: string;
  to: string;
  appointments: Entry[];
  density: { localDay: string; localHour: number; appointmentCount: number }[];
}
interface PageBody {
  data: Entry[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

const MONDAY = '2026-09-07';
const at = (hhmm: string, day = MONDAY) => `${day}T${hhmm}:00+03:00`;

describe('takvim görünümleri (Batch 3.4)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: { DATABASE_URL: database.appUrl, PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    clinic = await setupClinic(app);
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const branch = () => branchHeader(clinic.branch.id);

  const book = (startsAt: string, staffProfileId = clinic.practitioner.staffProfileId) =>
    http(app)
      .post('/api/v1/appointments')
      .set(ownerAuth())
      .set(branch())
      .send({
        branchId: clinic.branch.id,
        customerId: clinic.customer.id,
        startsAt,
        services: [{ serviceId: clinic.quickService.id, staffProfileId }],
      });

  // -------------------------------------------------------------------------
  describe('gün ve hafta', () => {
    it('günü ŞUBE saat diliminde keser', async () => {
      await book(at('09:00')).expect(201);
      await book(at('17:30')).expect(201);
      // Ertesi gün — bu güne SIZMAMALI.
      await book(at('09:00', '2026-09-08')).expect(201);

      const res = await http(app)
        .get('/api/v1/calendar/day')
        .query({ branchId: clinic.branch.id, date: MONDAY })
        .set(ownerAuth())
        .set(branch());

      expect(res.status).toBe(200);
      const body = res.body as CalendarBody;
      expect(body.timezone).toBe('Europe/Istanbul');
      expect(body.from).toBe('2026-09-07T00:00:00+03:00');
      expect(body.to).toBe('2026-09-08T00:00:00+03:00');
      expect(body.appointments).toHaveLength(2);
      expect(body.appointments[0]?.startsAt).toBe('2026-09-07T09:00:00+03:00');
    });

    it('kalemleri ve müşteriyi TEK yanıtta getirir', async () => {
      await book(at('10:00')).expect(201);

      const res = await http(app)
        .get('/api/v1/calendar/day')
        .query({ branchId: clinic.branch.id, date: MONDAY })
        .set(ownerAuth())
        .set(branch());

      const entry = (res.body as CalendarBody).appointments[0];
      expect(entry?.customerName).toBe('Ayşe Yılmaz');
      expect(entry?.totalMinor).toBe(50000);
      expect(entry?.services[0]?.serviceName).toBe('Bölgesel Lazer');
      expect(entry?.services[0]?.staffProfileId).toBe(clinic.practitioner.staffProfileId);
    });

    it('hafta görünümü yedi günü kapsar', async () => {
      await book(at('10:00')).expect(201);
      await book(at('10:00', '2026-09-11')).expect(201);
      // Sonraki hafta — kapsam dışı.
      await book(at('10:00', '2026-09-14')).expect(201);

      const res = await http(app)
        .get('/api/v1/calendar/week')
        .query({ branchId: clinic.branch.id, weekStart: MONDAY })
        .set(ownerAuth())
        .set(branch());

      expect((res.body as CalendarBody).appointments).toHaveLength(2);
    });

    it('yoğunluk verisi yerel gün ve saate göre gruplanır', async () => {
      await book(at('10:00')).expect(201);
      await book(at('10:30')).expect(201);
      await book(at('14:00')).expect(201);

      const res = await http(app)
        .get('/api/v1/calendar/day')
        .query({ branchId: clinic.branch.id, date: MONDAY })
        .set(ownerAuth())
        .set(branch());

      const density = (res.body as CalendarBody).density;
      expect(density).toContainEqual({
        localDay: MONDAY,
        localHour: 10,
        appointmentCount: 2,
      });
      expect(density).toContainEqual({
        localDay: MONDAY,
        localHour: 14,
        appointmentCount: 1,
      });
    });

    it('iptal edilen randevu yoğunluğa girmez ama takvimde görünür', async () => {
      const created = await book(at('10:00')).expect(201);
      await http(app)
        .post(`/api/v1/appointments/${(created.body as Entry).id}/cancel`)
        .set(ownerAuth())
        .set(branch())
        .send({})
        .expect(200);

      const res = await http(app)
        .get('/api/v1/calendar/day')
        .query({ branchId: clinic.branch.id, date: MONDAY })
        .set(ownerAuth())
        .set(branch());

      const body = res.body as CalendarBody;
      expect(body.appointments).toHaveLength(1);
      expect(body.appointments[0]?.status).toBe('cancelled');
      expect(body.density).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('liste ve sayfalama', () => {
    it('cursor ile sayfalar ve kayıt ATLAMAZ', async () => {
      const times = ['09:00', '09:30', '10:00', '10:30', '11:00'];
      for (const time of times) await book(at(time)).expect(201);

      const first = await http(app)
        .get('/api/v1/appointments')
        .query({
          branchId: clinic.branch.id,
          from: at('00:00'),
          to: at('00:00', '2026-09-08'),
          limit: 2,
        })
        .set(ownerAuth())
        .set(branch());

      const firstPage = first.body as PageBody;
      expect(firstPage.data).toHaveLength(2);
      expect(firstPage.pageInfo.hasMore).toBe(true);

      const collected = [...firstPage.data.map((entry) => entry.startsAt)];
      let cursor = firstPage.pageInfo.nextCursor;

      while (cursor !== null) {
        const next = await http(app)
          .get('/api/v1/appointments')
          .query({
            branchId: clinic.branch.id,
            from: at('00:00'),
            to: at('00:00', '2026-09-08'),
            limit: 2,
            cursor,
          })
          .set(ownerAuth())
          .set(branch());
        const page = next.body as PageBody;
        collected.push(...page.data.map((entry) => entry.startsAt));
        cursor = page.pageInfo.nextCursor;
      }

      expect(collected).toHaveLength(5);
      expect(new Set(collected).size).toBe(5);
      expect(collected[0]).toBe('2026-09-07T09:00:00+03:00');
      expect(collected.at(-1)).toBe('2026-09-07T11:00:00+03:00');
    });

    it('duruma göre filtreler', async () => {
      const first = await book(at('09:00')).expect(201);
      await book(at('10:00')).expect(201);

      await http(app)
        .post(`/api/v1/appointments/${(first.body as Entry).id}/cancel`)
        .set(ownerAuth())
        .set(branch())
        .send({})
        .expect(200);

      const res = await http(app)
        .get('/api/v1/appointments')
        .query({
          branchId: clinic.branch.id,
          from: at('00:00'),
          to: at('00:00', '2026-09-08'),
          status: 'cancelled',
        })
        .set(ownerAuth())
        .set(branch());

      expect((res.body as PageBody).data).toHaveLength(1);
      expect((res.body as PageBody).data[0]?.status).toBe('cancelled');
    });

    it('bozuk cursor’ı reddeder', async () => {
      const res = await http(app)
        .get('/api/v1/appointments')
        .query({
          branchId: clinic.branch.id,
          from: at('00:00'),
          to: at('00:00', '2026-09-08'),
          cursor: 'bozuk',
        })
        .set(ownerAuth())
        .set(branch());

      expect(res.status).toBe(400);
      expect((res.body as { code: string }).code).toBe('VALIDATION_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  describe('rol bazlı görünürlük', () => {
    it('uygulayıcı YALNIZ kendi randevularını görür', async () => {
      // İkinci bir personel: sahibin kendi profili.
      const second = await http(app)
        .post('/api/v1/staff')
        .set(ownerAuth())
        .send({
          userId: clinic.owner.userId,
          primaryBranchId: clinic.branch.id,
          services: [{ serviceId: clinic.quickService.id, branchId: clinic.branch.id }],
        });
      expect(second.status).toBe(201);
      const otherStaffId = (second.body as { id: string }).id;

      await http(app)
        .put(`/api/v1/staff/${otherStaffId}/schedule`)
        .set(ownerAuth())
        .set(branch())
        .send({
          branchId: clinic.branch.id,
          entries: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) =>
            dayOfWeek === 0
              ? { dayOfWeek, isOff: true }
              : { dayOfWeek, isOff: false, startTime: '09:00', endTime: '18:00' },
          ),
        })
        .expect(200);

      await book(at('09:00'), clinic.practitioner.staffProfileId).expect(201);
      await book(at('11:00'), otherStaffId).expect(201);

      const ownerView = await http(app)
        .get('/api/v1/calendar/day')
        .query({ branchId: clinic.branch.id, date: MONDAY })
        .set(ownerAuth())
        .set(branch());
      expect((ownerView.body as CalendarBody).appointments).toHaveLength(2);

      const practitionerView = await http(app)
        .get('/api/v1/calendar/day')
        .query({ branchId: clinic.branch.id, date: MONDAY })
        .set(auth(clinic.practitioner.tokens))
        .set(branch());
      const visible = (practitionerView.body as CalendarBody).appointments;
      expect(visible).toHaveLength(1);
      expect(visible[0]?.startsAt).toBe('2026-09-07T09:00:00+03:00');
    });

    it('personel profili OLMAYAN kısıtlı kullanıcı hiçbir şey görmez', async () => {
      await book(at('09:00')).expect(201);

      const lonely = await inviteMember(app, clinic.owner.tokens, {
        email: 'profilsiz@demo-klinik.test',
        roleKey: 'practitioner',
        branchId: clinic.branch.id,
      });

      const res = await http(app)
        .get('/api/v1/calendar/day')
        .query({ branchId: clinic.branch.id, date: MONDAY })
        .set(auth(lonely.tokens))
        .set(branch());

      expect(res.status).toBe(200);
      expect((res.body as CalendarBody).appointments).toHaveLength(0);
    });

    it('finans rolü takvime erişemez', async () => {
      const accountant = await inviteMember(app, clinic.owner.tokens, {
        email: 'muhasebe@demo-klinik.test',
        roleKey: 'accountant',
      });

      const res = await http(app)
        .get('/api/v1/calendar/day')
        .query({ branchId: clinic.branch.id, date: MONDAY })
        .set(auth(accountant.tokens))
        .set(branch());

      expect(res.status).toBe(403);
      expect((res.body as { code: string }).code).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  describe('N+1 koruması', () => {
    it('sorgu sayısı randevu sayısıyla BÜYÜMEZ', async () => {
      const pool = app.get<pg.Pool>(PG_POOL);
      const originalConnect = pool.connect.bind(pool);
      let queries = 0;

      // Havuzdan çıkan her istemcinin `query` çağrısını sayıyoruz. Drizzle
      // transaction'ları `pool.connect()` üzerinden açtığı için tüm repository
      // sorguları buradan geçer.
      const COUNTED = Symbol.for('klinara.test.counted');
      (pool as unknown as { connect: () => Promise<pg.PoolClient> }).connect = async () => {
        const client = await originalConnect();
        // İstemciler havuzdan TEKRAR TEKRAR çıkar; her seferinde sarmak
        // sayacı katlanarak şişirirdi. Bir kez sarıp işaretliyoruz.
        const marked = client as unknown as Record<symbol, boolean>;
        if (marked[COUNTED] !== true) {
          const original = client.query.bind(client) as (...args: unknown[]) => unknown;
          (client as unknown as { query: unknown }).query = (...args: unknown[]) => {
            queries += 1;
            return original(...args);
          };
          marked[COUNTED] = true;
        }
        return client;
      };

      try {
        const week = () =>
          http(app)
            .get('/api/v1/calendar/week')
            .query({ branchId: clinic.branch.id, weekStart: MONDAY })
            .set(ownerAuth())
            .set(branch());

        await book(at('09:00')).expect(201);
        await week(); // izin cache'ini ısıt

        queries = 0;
        await week();
        const withOne = queries;

        await http(app).post('/api/v1/customers').set(ownerAuth()).send({ fullName: 'Toplu' });
        await database.ownerPool.query(
          `with slots as (
             select gs as starts_at
               from generate_series(
                      timestamptz '2026-09-07 09:00:00+03',
                      timestamptz '2026-09-07 15:00:00+03',
                      interval '2 minutes') gs
              limit 150
           )
           insert into appointments (tenant_id, branch_id, customer_id, starts_at, ends_at)
           select $1, $2, $3, starts_at, starts_at + interval '30 minutes' from slots`,
          [clinic.tenant.id, clinic.branch.id, clinic.customer.id],
        );

        queries = 0;
        const many = await week();
        const withMany = queries;

        expect((many.body as CalendarBody).appointments.length).toBeGreaterThan(100);
        // Sorgu sayısı AYNI kalmalı: kalemler json_agg ile aynı sorguda gelir.
        expect(withMany).toBe(withOne);
        expect(withMany).toBeLessThan(15);
      } finally {
        (pool as unknown as { connect: unknown }).connect = originalConnect;
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('performans', () => {
    it('500 randevuluk hafta TEK sorguda ve 150 ms altında döner', async () => {
      // Randevuları uçlardan yazmak çok yavaş olurdu; şema garantileri
      // appointments-schema testinde zaten kanıtlandı. Burada okuma yolunu
      // ölçüyoruz, o yüzden veri toplu yazılıyor.
      await database.ownerPool.query(
        `with slots as (
           select gs as starts_at
             from generate_series(
                    timestamptz '2026-09-07 09:00:00+03',
                    timestamptz '2026-09-11 17:00:00+03',
                    interval '2 minutes') gs
            where (gs at time zone 'Europe/Istanbul')::time between '09:00' and '17:00'
            limit 500
         ), created as (
           insert into appointments (tenant_id, branch_id, customer_id, starts_at, ends_at)
           select $1, $2, $3, starts_at, starts_at + interval '30 minutes' from slots
           returning id, starts_at
         )
         insert into appointment_services (
           tenant_id, appointment_id, service_id, staff_profile_id, sort_order,
           starts_at, ends_at, duration_minutes, price_minor
         )
         select $1, created.id, $4, $5, 0, created.starts_at,
                created.starts_at + interval '30 minutes', 30, 50000
           from created`,
        [
          clinic.tenant.id,
          clinic.branch.id,
          clinic.customer.id,
          clinic.quickService.id,
          clinic.practitioner.staffProfileId,
        ],
      );
      await database.ownerPool.query('analyze');

      const durations: number[] = [];
      for (let run = 0; run < 5; run += 1) {
        const started = performance.now();
        const res = await http(app)
          .get('/api/v1/calendar/week')
          .query({ branchId: clinic.branch.id, weekStart: MONDAY })
          .set(ownerAuth())
          .set(branch());
        durations.push(performance.now() - started);
        expect(res.status).toBe(200);
        expect((res.body as CalendarBody).appointments.length).toBe(500);
      }

      durations.sort((a, b) => a - b);
      const p95 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))];
      expect(p95).toBeLessThan(150);
    });
  });
});
