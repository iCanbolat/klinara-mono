import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { bootstrapTenant, http, auth, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';
import {
  countActiveBookings,
  createAppointment,
  pgCode,
  readAppointment,
  setStatus,
  tenantCtx,
} from '../helpers/booking';
import { DRIZZLE, type Database } from '../../src/database/database.constants';
import { withTenantTx } from '../../src/database/tenant-tx';

/** 2026-09-07 Pazartesi, İstanbul saatiyle. */
const at = (hhmm: string) => new Date(`2026-09-07T${hhmm}:00+03:00`);

describe('randevu şeması ve çakışma garantisi (Batch 3.1)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let db: Database;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: { DATABASE_URL: database.appUrl, PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN },
    });
    db = app.get<Database>(DRIZZLE);
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    clinic = await setupClinic(app);
  });

  const ctx = () => tenantCtx(clinic.tenant.id, clinic.owner.userId);

  const booking = (from: string, to: string, overrides: Record<string, unknown> = {}) => ({
    branchId: clinic.branch.id,
    customerId: clinic.customer.id,
    serviceId: clinic.quickService.id,
    staffProfileId: clinic.practitioner.staffProfileId,
    startsAt: at(from),
    endsAt: at(to),
    ...overrides,
  });

  // -------------------------------------------------------------------------
  describe('çakışma engelleme', () => {
    it('EŞ ZAMANLI iki istekten tam olarak biri kazanır', async () => {
      // Bu testin varlık sebebi: "önce bak, sonra yaz" mantığı bu senaryoda
      // İKİSİNİ de yazardı. Doğru yaklaşım doğrudan yazıp 23P01 yakalamaktır.
      const attempts = Array.from({ length: 20 }, () =>
        createAppointment(db, ctx(), booking('10:00', '10:30')).then(
          () => 'ok' as const,
          (error: unknown) => pgCode(error) ?? 'other',
        ),
      );

      const results = await Promise.all(attempts);
      expect(results.filter((r) => r === 'ok')).toHaveLength(1);
      expect(results.filter((r) => r === '23P01')).toHaveLength(19);
    });

    it('kesişen aralık reddedilir, sırt sırta aralık kabul edilir', async () => {
      await createAppointment(db, ctx(), booking('10:00', '10:30'));

      // `[)` sınırı: 10:30 başlangıcı 10:00–10:30 aralığına DEĞMEZ.
      await expect(createAppointment(db, ctx(), booking('10:30', '11:00'))).resolves.toBeDefined();

      const overlap = await createAppointment(db, ctx(), booking('10:15', '10:45')).catch(
        (e: unknown) => pgCode(e),
      );
      expect(overlap).toBe('23P01');
    });

    it('görünür saatler ayrık olsa da BUFFER’lar kesişiyorsa reddedilir', async () => {
      // Hizmet: 5 dk hazırlık + 10 dk temizlik. 11:00–12:00 randevusu takvimde
      // 10:55–12:10'u tutar; 12:05 başlayan bir randevu müşteriye "boş" görünür
      // ama personel hâlâ meşguldür.
      await createAppointment(
        db,
        ctx(),
        booking('11:00', '12:00', {
          serviceId: clinic.service.id,
          bufferBeforeMinutes: 5,
          bufferAfterMinutes: 10,
        }),
      );

      const code = await createAppointment(
        db,
        ctx(),
        booking('12:05', '13:05', {
          serviceId: clinic.service.id,
          bufferBeforeMinutes: 5,
          bufferAfterMinutes: 10,
        }),
      ).catch((e: unknown) => pgCode(e));

      expect(code).toBe('23P01');

      // Buffer'lar da ayrıldığında aynı slot yazılabilir olmalı.
      await expect(
        createAppointment(
          db,
          ctx(),
          booking('12:15', '13:15', {
            serviceId: clinic.service.id,
            bufferBeforeMinutes: 5,
            bufferAfterMinutes: 10,
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('iptal edilen randevunun slotu serbest kalır', async () => {
      const first = await createAppointment(db, ctx(), booking('14:00', '14:30'));

      const blocked = await createAppointment(db, ctx(), booking('14:00', '14:30')).catch(
        (e: unknown) => pgCode(e),
      );
      expect(blocked).toBe('23P01');

      await setStatus(db, ctx(), first, 'cancelled');

      // Trigger `active = false` yapar; satır SİLİNMEZ (denetim izi).
      expect(await countActiveBookings(db, ctx(), first)).toBe(0);
      await expect(createAppointment(db, ctx(), booking('14:00', '14:30'))).resolves.toBeDefined();
    });

    it('gelmedi (no_show) işareti de slotu serbest bırakır', async () => {
      const first = await createAppointment(db, ctx(), booking('15:00', '15:30'));
      await setStatus(db, ctx(), first, 'no_show');

      expect(await countActiveBookings(db, ctx(), first)).toBe(0);
      await expect(createAppointment(db, ctx(), booking('15:00', '15:30'))).resolves.toBeDefined();
    });

    it('aynı müşterinin çakışan randevusu (kural açıkken) engellenir', async () => {
      await createAppointment(
        db,
        ctx(),
        booking('09:00', '09:30', { withCustomerBooking: true }),
      );

      // Farklı personel: kaynak çakışması YOK, çakışan tek şey müşterinin kendisi.
      const second = await http(app)
        .post('/api/v1/staff')
        .set(auth(clinic.owner.tokens))
        .send({ userId: clinic.owner.userId, services: [{ serviceId: clinic.quickService.id }] });
      expect(second.status).toBe(201);
      const otherStaffId = (second.body as { id: string }).id;

      const code = await createAppointment(
        db,
        ctx(),
        booking('09:15', '09:45', {
          staffProfileId: otherStaffId,
          withCustomerBooking: true,
        }),
      ).catch((e: unknown) => pgCode(e));

      expect(code).toBe('23P01');
    });
  });

  // -------------------------------------------------------------------------
  describe('durum makinesi', () => {
    it('geçerli zinciri sonuna kadar yürütür ve versiyonu artırır', async () => {
      const id = await createAppointment(db, ctx(), booking('10:00', '10:30'));
      expect((await readAppointment(db, ctx(), id))?.version).toBe(1);

      for (const status of ['confirmed', 'arrived', 'in_progress', 'completed']) {
        await setStatus(db, ctx(), id, status);
      }

      const row = await readAppointment(db, ctx(), id);
      expect(row?.status).toBe('completed');
      // Dört güncelleme = dört artış. Sayaç trigger'da artar; bir güncelleme
      // yolunun onu atlaması mümkün değildir.
      expect(row?.version).toBe(5);
    });

    it('geçersiz geçişi K0001 ile reddeder', async () => {
      const id = await createAppointment(db, ctx(), booking('10:00', '10:30'));

      const code = await setStatus(db, ctx(), id, 'completed').catch((e: unknown) => pgCode(e));
      expect(code).toBe('K0001');
      expect((await readAppointment(db, ctx(), id))?.status).toBe('scheduled');
    });

    it('iptal edilmiş randevu yeniden açılamaz (terminal durum)', async () => {
      const id = await createAppointment(db, ctx(), booking('10:00', '10:30'));
      await setStatus(db, ctx(), id, 'cancelled');

      const code = await setStatus(db, ctx(), id, 'scheduled').catch((e: unknown) => pgCode(e));
      expect(code).toBe('K0001');
    });

    it('tamamlanmış randevuyu geri açma geçişi TANIMLI ve izne bağlıdır', async () => {
      const id = await createAppointment(db, ctx(), booking('10:00', '10:30'));
      for (const status of ['confirmed', 'arrived', 'in_progress', 'completed']) {
        await setStatus(db, ctx(), id, status);
      }

      await expect(setStatus(db, ctx(), id, 'in_progress')).resolves.toBeUndefined();

      const required = await withTenantTx(db, ctx(), async (tx) => {
        const res = await tx.execute<{ required_permission: string | null }>(sql`
          select required_permission from appointment_status_transitions
           where from_status = 'completed' and to_status = 'in_progress'
        `);
        return res.rows[0]?.required_permission;
      });
      expect(required).toBe('appointment:reopen');
    });

    it('durum geçiş tablosu uygulama tarafından DEĞİŞTİRİLEMEZ', async () => {
      const code = await withTenantTx(db, ctx(), async (tx) => {
        await tx.execute(sql`
          insert into appointment_status_transitions (from_status, to_status)
          values ('cancelled', 'scheduled')
        `);
      }).catch((e: unknown) => pgCode(e));

      expect(code).toBe('42501');
    });
  });

  // -------------------------------------------------------------------------
  describe('kapsam ve yetkinlik', () => {
    it('yetkin OLMAYAN personele randevu açılamaz (K0003)', async () => {
      // Yetkinlik matrisini boşaltıyoruz: personel artık bu hizmeti yapamaz.
      await http(app)
        .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/services`)
        .set(auth(clinic.owner.tokens))
        .send({ services: [] })
        .expect(200);

      const code = await createAppointment(db, ctx(), booking('10:00', '10:30')).catch(
        (e: unknown) => pgCode(e),
      );
      expect(code).toBe('K0003');
    });

    it('pasif hizmete randevu açılamaz (K0002)', async () => {
      await http(app)
        .delete(`/api/v1/services/${clinic.quickService.id}`)
        .set(auth(clinic.owner.tokens))
        .expect(200);

      const code = await createAppointment(db, ctx(), booking('10:00', '10:30')).catch(
        (e: unknown) => pgCode(e),
      );
      expect(code).toBe('K0002');
    });

    it('BAŞKA kiracının müşterisine randevu yazılamaz', async () => {
      const other = await bootstrapTenant(app, { slug: 'klinik-b' });
      const otherCustomer = await http(app)
        .post('/api/v1/customers')
        .set(auth(other.owner.tokens))
        .send({ fullName: 'Yabancı Müşteri' });
      expect(otherCustomer.status).toBe(201);

      const code = await createAppointment(
        db,
        ctx(),
        booking('10:00', '10:30', { customerId: (otherCustomer.body as { id: string }).id }),
      ).catch((e: unknown) => pgCode(e));

      // FK doğrulaması RLS'i bypass eder; kuralı tutan kapsam trigger'ıdır.
      expect(code).toBe('23514');
    });

    it('bir kiracının randevusu diğerinin context’inde görünmez', async () => {
      const id = await createAppointment(db, ctx(), booking('10:00', '10:30'));
      const other = await bootstrapTenant(app, { slug: 'klinik-b' });

      const rows = await withTenantTx(db, tenantCtx(other.tenant.id), async (tx) => {
        const res = await tx.execute<{ count: number }>(sql`
          select count(*)::int as count from appointments where id = ${id}
        `);
        return Number(res.rows[0]?.count ?? 0);
      });
      expect(rows).toBe(0);
    });

    it('bitiş başlangıçtan önce olamaz', async () => {
      const code = await createAppointment(db, ctx(), booking('11:00', '10:00')).catch(
        (e: unknown) => pgCode(e),
      );
      expect(code).toBe('23514');
    });
  });
});
