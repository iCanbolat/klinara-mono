import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';
import {
  createPackageDefinition,
  sellPackage,
  type CustomerPackageFixture,
  type PackageDefinitionFixture,
} from '../helpers/packages';

interface AppointmentBody {
  id: string;
  status: string;
  services: { id: string; serviceId: string; customerPackageItemId: string | null }[];
}

const MONDAY = '2026-09-07';
const at = (hhmm: string) => `${MONDAY}T${hhmm}:00+03:00`;

describe('paket tüketimi, iade, devir ve süre dolumu (Batch 5.3)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;
  let definition: PackageDefinitionFixture;
  let sold: CustomerPackageFixture;

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
    // Tek kalem, 10 seans hızlı hizmet — randevu kurulumu sade kalsın.
    definition = await createPackageDefinition(app, clinic.owner.tokens, {
      slug: 'bolgesel-10',
      name: '10 Seans Bölgesel',
      totalPriceMinor: 400_000,
      validityDays: 365,
      items: [{ serviceId: clinic.quickService.id, quantity: 10 }],
    });
    sold = await sellPackage(app, clinic.owner.tokens, clinic.branch.id, {
      customerId: clinic.customer.id,
      definitionId: definition.id,
    });
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const branch = () => branchHeader(clinic.branch.id);
  const itemId = () => sold.items[0]?.id ?? '';

  const createAppointment = (startsAt: string, packageItemId: string | null) =>
    http(app)
      .post('/api/v1/appointments')
      .set(ownerAuth())
      .set(branch())
      .send({
        branchId: clinic.branch.id,
        customerId: clinic.customer.id,
        startsAt,
        services: [
          {
            serviceId: clinic.quickService.id,
            staffProfileId: clinic.practitioner.staffProfileId,
            ...(packageItemId === null ? {} : { customerPackageItemId: packageItemId }),
          },
        ],
      });

  const setStatus = (id: string, status: string, extra: Record<string, unknown> = {}) =>
    http(app)
      .post(`/api/v1/appointments/${id}/status`)
      .set(ownerAuth())
      .set(branch())
      .send({ status, ...extra });

  const advanceTo = async (id: string, target: string) => {
    for (const status of ['confirmed', 'arrived', 'in_progress']) {
      await setStatus(id, status).expect(200);
      if (status === target) return;
    }
    await setStatus(id, target).expect(200);
  };

  const remaining = async (): Promise<number> => {
    const result = await database.ownerPool.query<{ remaining_sessions: number }>(
      'select remaining_sessions from customer_package_items where id = $1',
      [itemId()],
    );
    return Number(result.rows[0]?.remaining_sessions);
  };

  const ledgerRows = async (): Promise<{ entry_type: string; delta: number; reverses: string | null }[]> => {
    const result = await database.ownerPool.query<{
      entry_type: string;
      delta: number;
      reverses: string | null;
    }>(
      `select entry_type, delta, reverses_entry_id as reverses
         from package_ledger_entries where customer_package_id = $1
        order by created_at, id`,
      [sold.id],
    );
    return result.rows;
  };

  // -------------------------------------------------------------------------
  describe('tüketim', () => {
    it('randevu tamamlanınca AYNI transactionda bir seans düşer', async () => {
      const created = await createAppointment(at('10:00'), itemId()).expect(201);
      const id = (created.body as AppointmentBody).id;

      expect(await remaining()).toBe(10);
      await advanceTo(id, 'completed');
      expect(await remaining()).toBe(9);

      const rows = await ledgerRows();
      expect(rows.filter((row) => row.entry_type === 'consume')).toHaveLength(1);
      expect(rows.at(-1)?.delta).toBe(-1);
    });

    it('randevu yanıtı bağlı paket kalemini döndürür', async () => {
      // İstemci "bu hizmet şu paketten düşecek"i ancak yanıttan okuyabilir;
      // alan düşerse iOS randevu detayında sessizce kör kalır.
      const bound = await createAppointment(at('10:00'), itemId()).expect(201);
      expect((bound.body as AppointmentBody).services[0]?.customerPackageItemId).toBe(itemId());

      const free = await createAppointment(at('12:00'), null).expect(201);
      expect((free.body as AppointmentBody).services[0]?.customerPackageItemId).toBeNull();

      const fetched = await http(app)
        .get(`/api/v1/appointments/${(bound.body as AppointmentBody).id}`)
        .set(ownerAuth())
        .set(branch())
        .expect(200);
      expect((fetched.body as AppointmentBody).services[0]?.customerPackageItemId).toBe(itemId());
    });

    it('pakete bağlı olmayan randevu hiçbir hak düşmez', async () => {
      const created = await createAppointment(at('10:00'), null).expect(201);
      await advanceTo((created.body as AppointmentBody).id, 'completed');
      expect(await remaining()).toBe(10);
    });

    it('hak yetersizken randevu TAMAMLANMAZ ve defter kıpırdamaz', async () => {
      // Kalan hakkı sıfırla.
      await http(app)
        .post(`/api/v1/customer-packages/${sold.id}/adjust`)
        .set(ownerAuth())
        .set('if-match', `W/"${sold.version}"`)
        .send({ items: [{ customerPackageItemId: itemId(), delta: -10 }], reason: 'test icin sifirla' })
        .expect(200);
      expect(await remaining()).toBe(0);

      const created = await createAppointment(at('10:00'), itemId()).expect(201);
      const id = (created.body as AppointmentBody).id;
      await advanceTo(id, 'in_progress');

      const response = await setStatus(id, 'completed');
      expect(response.status).toBe(409);
      expect((response.body as { code: string }).code).toBe('PACKAGE_EXHAUSTED');

      // Randevu hâlâ in_progress ve yeni defter satırı yok (ownerPool ile).
      const current = await database.ownerPool.query<{ status: string }>(
        'select status from appointments where id = $1',
        [id],
      );
      expect(current.rows[0]?.status).toBe('in_progress');
      expect((await ledgerRows()).filter((row) => row.entry_type === 'consume')).toHaveLength(0);
    });

    it('tamamlama geri alınınca ters kayıt üretir, tekrar tamamlanınca yeniden düşer', async () => {
      const created = await createAppointment(at('10:00'), itemId()).expect(201);
      const id = (created.body as AppointmentBody).id;
      await advanceTo(id, 'completed');
      expect(await remaining()).toBe(9);

      await setStatus(id, 'in_progress', { reason: 'yanlis tamamlandi' }).expect(200);
      expect(await remaining()).toBe(10);

      const rows = await ledgerRows();
      const reversal = rows.at(-1);
      expect(reversal?.entry_type).toBe('consume');
      expect(reversal?.delta).toBe(1);
      expect(reversal?.reverses).not.toBeNull();

      await setStatus(id, 'completed').expect(200);
      expect(await remaining()).toBe(9);
      expect((await ledgerRows()).filter((row) => row.entry_type === 'consume')).toHaveLength(3);
    });

    it('aynı statüye ikinci kez geçmek ikinci kez düşmez', async () => {
      const created = await createAppointment(at('10:00'), itemId()).expect(201);
      const id = (created.body as AppointmentBody).id;
      await advanceTo(id, 'completed');
      await setStatus(id, 'completed').expect(200);
      expect(await remaining()).toBe(9);
    });

    it('süresi dolmuş paketten tüketim reddedilir', async () => {
      const created = await createAppointment(at('10:00'), itemId()).expect(201);
      const id = (created.body as AppointmentBody).id;
      await advanceTo(id, 'in_progress');

      await database.ownerPool.query(
        `update customer_packages
            set sold_at = now() - interval '2 days', expires_at = now() - interval '1 day'
          where id = $1`,
        [sold.id],
      );

      const response = await setStatus(id, 'completed');
      expect(response.status).toBe(409);
      expect((response.body as { code: string }).code).toBe('PACKAGE_EXPIRED');
      expect(await remaining()).toBe(10);
    });

    it('yanlış hizmetin kalemine bağlanamaz', async () => {
      const response = await http(app)
        .post('/api/v1/appointments')
        .set(ownerAuth())
        .set(branch())
        .send({
          branchId: clinic.branch.id,
          customerId: clinic.customer.id,
          startsAt: at('10:00'),
          services: [
            {
              // Paket kalemi `quickService` için; burada `service` isteniyor.
              serviceId: clinic.service.id,
              staffProfileId: clinic.practitioner.staffProfileId,
              customerPackageItemId: itemId(),
            },
          ],
        });
      expect(response.status).toBe(422);
    });

    it('başka müşterinin paket kalemine bağlanamaz', async () => {
      const other = await http(app)
        .post('/api/v1/customers')
        .set(ownerAuth())
        .send({ fullName: 'Başka Müşteri' })
        .expect(201);

      const response = await http(app)
        .post('/api/v1/appointments')
        .set(ownerAuth())
        .set(branch())
        .send({
          branchId: clinic.branch.id,
          customerId: (other.body as { id: string }).id,
          startsAt: at('10:00'),
          services: [
            {
              serviceId: clinic.quickService.id,
              staffProfileId: clinic.practitioner.staffProfileId,
              customerPackageItemId: itemId(),
            },
          ],
        });
      expect(response.status).toBe(422);
    });

    it('consume-package ucu tamamlanmış randevuya sonradan bağlar ve düşer', async () => {
      const created = await createAppointment(at('10:00'), null).expect(201);
      const appointment = created.body as AppointmentBody;
      await advanceTo(appointment.id, 'completed');
      expect(await remaining()).toBe(10);

      const response = await http(app)
        .post(`/api/v1/appointments/${appointment.id}/consume-package`)
        .set(ownerAuth())
        .send({
          lines: [
            {
              appointmentServiceId: appointment.services[0]?.id,
              customerPackageItemId: itemId(),
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ bound: 1, consumed: 1 });
      expect(await remaining()).toBe(9);
    });
  });

  // -------------------------------------------------------------------------
  describe('kullanılabilir haklar', () => {
    it('aktif, süresi dolmamış ve kalanı olan kalemleri döner', async () => {
      const list = await http(app)
        .get(`/api/v1/customers/${clinic.customer.id}/package-entitlements?serviceId=${clinic.quickService.id}`)
        .set(ownerAuth());
      expect(list.status).toBe(200);
      expect((list.body as { customerPackageItemId: string }[])).toHaveLength(1);

      await database.ownerPool.query(
        `update customer_packages
            set sold_at = now() - interval '2 days', expires_at = now() - interval '1 day'
          where id = $1`,
        [sold.id],
      );
      const after = await http(app)
        .get(`/api/v1/customers/${clinic.customer.id}/package-entitlements`)
        .set(ownerAuth());
      expect(after.body).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('düzeltme', () => {
    it('gerekçesiz düzeltme reddedilir, gerekçeli düzeltme iz bırakır', async () => {
      const without = await http(app)
        .post(`/api/v1/customer-packages/${sold.id}/adjust`)
        .set(ownerAuth())
        .set('if-match', `W/"${sold.version}"`)
        .send({ items: [{ customerPackageItemId: itemId(), delta: -1 }], reason: 'kis' });
      expect(without.status).toBe(400);

      const withReason = await http(app)
        .post(`/api/v1/customer-packages/${sold.id}/adjust`)
        .set(ownerAuth())
        .set('if-match', `W/"${sold.version}"`)
        .send({
          items: [{ customerPackageItemId: itemId(), delta: -1 }],
          reason: 'musteri hediye seans kullandi',
        });
      expect(withReason.status).toBe(200);
      expect(await remaining()).toBe(9);

      const rows = await ledgerRows();
      expect(rows.at(-1)?.entry_type).toBe('manual_adjustment');
    });

    it('bayat If-Match ile düzeltme 409 verir ve deftere DOKUNMAZ', async () => {
      const response = await http(app)
        .post(`/api/v1/customer-packages/${sold.id}/adjust`)
        .set(ownerAuth())
        .set('if-match', 'W/"99"')
        .send({ items: [{ customerPackageItemId: itemId(), delta: -1 }], reason: 'bayat surum' });
      expect(response.status).toBe(409);
      expect((response.body as { code: string }).code).toBe('VERSION_CONFLICT');
      expect(await remaining()).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  describe('iade', () => {
    it('kalan hakkı satış anındaki tahsisten hesaplar ve borcu pending yazar', async () => {
      // 10 seans, 400.000 kuruş → seans başına 40.000.
      await http(app)
        .post(`/api/v1/customer-packages/${sold.id}/adjust`)
        .set(ownerAuth())
        .set('if-match', `W/"${sold.version}"`)
        .send({ items: [{ customerPackageItemId: itemId(), delta: -4 }], reason: 'dort seans kullanildi' })
        .expect(200);

      const current = await http(app)
        .get(`/api/v1/customer-packages/${sold.id}`)
        .set(ownerAuth());
      const version = (current.body as { version: number }).version;

      const response = await http(app)
        .post(`/api/v1/customer-packages/${sold.id}/refund`)
        .set(ownerAuth())
        .set('if-match', `W/"${version}"`)
        .send({ reason: 'musteri vazgecti' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        refundedSessions: 6,
        refundAmountMinor: 240_000,
        settlementStatus: 'pending',
      });
      expect(await remaining()).toBe(0);

      const after = await http(app).get(`/api/v1/customer-packages/${sold.id}`).set(ownerAuth());
      const body = after.body as { status: string; refundSettlementStatus: string };
      expect(body.status).toBe('refunded');
      expect(body.refundSettlementStatus).toBe('pending');
    });

    it('resepsiyon iade yapamaz', async () => {
      const receptionist = await inviteMember(app, clinic.owner.tokens, {
        email: 'resepsiyon@demo-klinik.test',
        roleKey: 'receptionist',
        branchId: clinic.branch.id,
        fullName: 'Resepsiyon',
      });

      const response = await http(app)
        .post(`/api/v1/customer-packages/${sold.id}/refund`)
        .set(auth(receptionist.tokens))
        .set('if-match', `W/"${sold.version}"`)
        .send({ reason: 'yetkisiz iade denemesi' });
      expect(response.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('devir', () => {
    it('kalan hakkı yeni bir pakete taşır ve toplam yükümlülüğü korur', async () => {
      const target = await http(app)
        .post('/api/v1/customers')
        .set(ownerAuth())
        .send({ fullName: 'Devir Alan' })
        .expect(201);
      const targetId = (target.body as { id: string }).id;

      const response = await http(app)
        .post(`/api/v1/customer-packages/${sold.id}/transfer`)
        .set(ownerAuth())
        .set('if-match', `W/"${sold.version}"`)
        .send({
          targetCustomerId: targetId,
          items: [{ customerPackageItemId: itemId(), sessions: 4 }],
          reason: 'kardesine devredildi',
        });

      expect(response.status).toBe(201);
      const created = response.body as { id: string; remainingSessions: number; outstandingMinor: number };
      expect(created.remainingSessions).toBe(4);
      expect(created.outstandingMinor).toBe(160_000);

      const source = await http(app).get(`/api/v1/customer-packages/${sold.id}`).set(ownerAuth());
      const sourceBody = source.body as { remainingSessions: number; outstandingMinor: number };
      expect(sourceBody.remainingSessions).toBe(6);
      expect(sourceBody.outstandingMinor).toBe(240_000);

      // Yükümlülük korunuyor: 400.000 = 240.000 + 160.000.
      expect(sourceBody.outstandingMinor + created.outstandingMinor).toBe(400_000);

      const transfers = await database.ownerPool.query<{ sessions: number; value_minor: string }>(
        'select sessions, value_minor from package_transfers where source_package_id = $1',
        [sold.id],
      );
      expect(transfers.rows).toHaveLength(1);
      expect(Number(transfers.rows[0]?.value_minor)).toBe(160_000);
    });

    it('devredilemez paket devredilemez', async () => {
      const closed = await createPackageDefinition(app, clinic.owner.tokens, {
        slug: 'devredilemez',
        name: 'Devredilemez Paket',
        totalPriceMinor: 100_000,
        isTransferable: false,
        items: [{ serviceId: clinic.quickService.id, quantity: 2 }],
      });
      const closedSale = await sellPackage(app, clinic.owner.tokens, clinic.branch.id, {
        customerId: clinic.customer.id,
        definitionId: closed.id,
      });

      const target = await http(app)
        .post('/api/v1/customers')
        .set(ownerAuth())
        .send({ fullName: 'Devir Alan' })
        .expect(201);

      const response = await http(app)
        .post(`/api/v1/customer-packages/${closedSale.id}/transfer`)
        .set(ownerAuth())
        .set('if-match', `W/"${closedSale.version}"`)
        .send({
          targetCustomerId: (target.body as { id: string }).id,
          reason: 'devredilemez paket denemesi',
        });
      expect(response.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('süre dolumu job', () => {
    it('süresi dolan paketi kapatır ve ikinci koşuşta yeni satır üretmez', async () => {
      const { PackageExpiryWorker } = await import(
        '../../src/modules/packages/package-expiry.worker'
      );
      const worker = app.get(PackageExpiryWorker);
      const tenantId = clinic.tenant.id;

      // Sınır: henüz dolmamış paket dokunulmaz.
      await database.ownerPool.query(
        `update customer_packages
            set sold_at = now() - interval '1 day', expires_at = now() + interval '1 second'
          where id = $1`,
        [sold.id],
      );
      await worker.handle({ tenantId });
      expect(await remaining()).toBe(10);

      await database.ownerPool.query(
        `update customer_packages
            set sold_at = now() - interval '1 day', expires_at = now() - interval '1 second'
          where id = $1`,
        [sold.id],
      );
      await worker.handle({ tenantId });
      expect(await remaining()).toBe(0);

      const first = await ledgerRows();
      expect(first.filter((row) => row.entry_type === 'expire')).toHaveLength(1);
      expect(first.at(-1)?.delta).toBe(-10);

      // İkinci koşuş: idempotence VERİDEN geliyor.
      await worker.handle({ tenantId });
      expect((await ledgerRows()).filter((row) => row.entry_type === 'expire')).toHaveLength(1);

      const status = await database.ownerPool.query<{ status: string }>(
        'select status from customer_packages where id = $1',
        [sold.id],
      );
      expect(status.rows[0]?.status).toBe('expired');
    });
  });
});
