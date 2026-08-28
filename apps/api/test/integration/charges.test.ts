import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN, type Tokens } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';
import { createPackageDefinition, sellPackage } from '../helpers/packages';
import { splitVatInclusive } from '../../src/common/money';

interface ChargeBody {
  id: string;
  source: string;
  description: string;
  quantity: number;
  unitListPriceMinor: number;
  unitPriceMinor: number;
  discountMinor: number;
  totalMinor: number;
  netMinor: number;
  vatMinor: number;
  status: string;
  version: number;
  appointmentServiceId: string | null;
  customerPackageId: string | null;
}

interface AccountBody {
  chargedMinor: number;
  paidMinor: number;
  balanceMinor: number;
  entries: { entryKind: string; entrySource: string; amountMinor: number }[];
}

interface Problem {
  code: string;
  status: number;
}

const MONDAY = '2026-09-07';
const at = (hhmm: string) => `${MONDAY}T${hhmm}:00+03:00`;

describe('ücret kalemleri, indirim ve cari hesap (Batch 6.1)', () => {
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

  const createAppointment = (startsAt: string, serviceId?: string) =>
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
            serviceId: serviceId ?? clinic.quickService.id,
            staffProfileId: clinic.practitioner.staffProfileId,
          },
        ],
      });

  const setStatus = (id: string, status: string) =>
    http(app)
      .post(`/api/v1/appointments/${id}/status`)
      .set(ownerAuth())
      .set(branch())
      .send({ status });

  /** Randevuyu `scheduled`dan `completed`a taşır (ara durumlar zorunlu). */
  const complete = async (id: string): Promise<void> => {
    for (const status of ['confirmed', 'arrived', 'in_progress', 'completed']) {
      const res = await setStatus(id, status);
      if (res.status !== 200) throw new Error(`${status}: ${res.status} ${res.text}`);
    }
  };

  const listCharges = (query = '') =>
    http(app).get(`/api/v1/charges${query}`).set(ownerAuth());

  const account = () =>
    http(app).get(`/api/v1/customers/${clinic.customer.id}/account`).set(ownerAuth());

  // -------------------------------------------------------------------------
  describe('KDV ve indirim aritmetiği', () => {
    it('KDV brüt tutarın İÇİNDEN çıkar ve net + KDV daima brüte eşittir', async () => {
      const res = await http(app)
        .post('/api/v1/charges')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          source: 'product',
          description: 'Bakım şampuanı',
          quantity: 3,
          unitPriceMinor: 33_333,
          vatRateBasisPoints: 2000,
        });

      expect(res.status).toBe(201);
      const body = res.body as ChargeBody;
      expect(body.totalMinor).toBe(99_999);
      expect(body.netMinor + body.vatMinor).toBe(body.totalMinor);
      // 99999 × 2000 / 12000 = 16666,5 → yarım ÇİFTE gider: 16666.
      expect(body.vatMinor).toBe(16_666);
      expect(body.netMinor).toBe(83_333);
    });

    it('kuruş kaybı yok: rastgele tutarlarda net + KDV = brüt', async () => {
      for (const [total, rate] of [
        [1, 2000],
        [7, 1000],
        [12_345, 1800],
        [999_999, 2000],
        [50_000, 0],
      ] as const) {
        const split = splitVatInclusive(total, rate);
        expect(split.netMinor + split.vatMinor).toBe(total);
      }
    });

    it('indirim önce satır toplamına uygulanır, KDV indirimli tutardan ayrılır', async () => {
      const discount = await http(app)
        .post('/api/v1/discounts')
        .set(ownerAuth())
        .send({ name: 'Yaz kampanyası', code: 'YAZ2026', kind: 'percent', value: 1500 });
      expect(discount.status).toBe(201);

      const res = await http(app)
        .post('/api/v1/charges')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          source: 'product',
          description: 'Bakım seti',
          unitPriceMinor: 100_000,
          discountId: (discount.body as { id: string }).id,
        });

      expect(res.status).toBe(201);
      const body = res.body as ChargeBody;
      expect(body.discountMinor).toBe(15_000);
      expect(body.totalMinor).toBe(85_000);
      expect(body.netMinor + body.vatMinor).toBe(85_000);
    });

    it('tutar indirimi satır toplamını aşamaz — sonuç negatife düşmez', async () => {
      const discount = await http(app)
        .post('/api/v1/discounts')
        .set(ownerAuth())
        .send({ name: 'Aşırı indirim', kind: 'amount', value: 500_000 });

      const res = await http(app)
        .post('/api/v1/charges')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          source: 'product',
          description: 'Küçük ürün',
          unitPriceMinor: 10_000,
          discountId: (discount.body as { id: string }).id,
        });

      expect(res.status).toBe(201);
      const body = res.body as ChargeBody;
      expect(body.discountMinor).toBe(10_000);
      expect(body.totalMinor).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('indirim geçerliliği', () => {
    it('süresi dolmuş indirim DISCOUNT_INVALID verir', async () => {
      const discount = await http(app)
        .post('/api/v1/discounts')
        .set(ownerAuth())
        .send({
          name: 'Biten kampanya',
          kind: 'percent',
          value: 1000,
          startsAt: '2020-01-01T00:00:00+03:00',
          endsAt: '2020-02-01T00:00:00+03:00',
        });

      const res = await http(app)
        .post('/api/v1/charges')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          source: 'product',
          description: 'Ürün',
          unitPriceMinor: 10_000,
          discountId: (discount.body as { id: string }).id,
        });

      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('DISCOUNT_INVALID');
    });

    it('kullanım hakkı tükenince DISCOUNT_INVALID verir; iptal hakkı geri verir', async () => {
      const discount = await http(app)
        .post('/api/v1/discounts')
        .set(ownerAuth())
        .send({ name: 'Tek kullanım', kind: 'amount', value: 1_000, maxRedemptions: 1 });
      const discountId = (discount.body as { id: string }).id;

      const send = () =>
        http(app)
          .post('/api/v1/charges')
          .set(ownerAuth())
          .set(branch())
          .send({
            customerId: clinic.customer.id,
            source: 'product',
            description: 'Ürün',
            unitPriceMinor: 10_000,
            discountId,
          });

      const first = await send();
      expect(first.status).toBe(201);

      const second = await send();
      expect(second.status).toBe(409);
      expect((second.body as Problem).code).toBe('DISCOUNT_INVALID');

      // İptal edilen satış kampanya kotasını YEMEZ.
      const firstBody = first.body as ChargeBody;
      const voided = await http(app)
        .post(`/api/v1/charges/${firstBody.id}/void`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${firstBody.version}"` })
        .send({ reason: 'Müşteri vazgeçti' });
      expect(voided.status).toBe(200);

      const third = await send();
      expect(third.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  describe('fiyat override yetkisi', () => {
    let receptionist: Tokens;

    beforeEach(async () => {
      const member = await inviteMember(app, clinic.owner.tokens, {
        email: `resepsiyon-charge@${clinic.tenant.slug}.test`,
        roleKey: 'receptionist',
        branchId: clinic.branch.id,
        fullName: 'Resepsiyon',
      });
      receptionist = member.tokens;
    });

    const overrideBody = (reason?: string) => ({
      customerId: clinic.customer.id,
      source: 'product' as const,
      description: 'İndirimli ürün',
      unitListPriceMinor: 100_000,
      unitPriceMinor: 60_000,
      ...(reason === undefined ? {} : { priceOverrideReason: reason }),
    });

    it('resepsiyon liste fiyatının dışına çıkamaz', async () => {
      const res = await http(app)
        .post('/api/v1/charges')
        .set(auth(receptionist))
        .set(branch())
        .send(overrideBody('Yönetici onayıyla'));

      expect(res.status).toBe(403);
    });

    it('yetkili kullanıcı da GEREKÇESİZ override yapamaz', async () => {
      const res = await http(app)
        .post('/api/v1/charges')
        .set(ownerAuth())
        .set(branch())
        .send(overrideBody());

      expect(res.status).toBe(422);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('gerekçeli override kabul edilir ve gerekçe kalemde saklanır', async () => {
      const res = await http(app)
        .post('/api/v1/charges')
        .set(ownerAuth())
        .set(branch())
        .send(overrideBody('Sadık müşteri indirimi'));

      expect(res.status).toBe(201);
      const body = res.body as ChargeBody & { priceOverrideReason: string | null };
      expect(body.totalMinor).toBe(60_000);
      expect(body.priceOverrideReason).toBe('Sadık müşteri indirimi');
    });
  });

  // -------------------------------------------------------------------------
  describe('randevudan doğan borç', () => {
    it('tamamlama borç yazar, geri alma onu `void` eder', async () => {
      const created = await createAppointment(at('10:00'));
      expect(created.status).toBe(201);
      const appointmentId = (created.body as { id: string }).id;

      await complete(appointmentId);

      const after = await listCharges('?status=open');
      const charges = (after.body as { data: ChargeBody[] }).data;
      expect(charges).toHaveLength(1);
      expect(charges[0]?.source).toBe('appointment_service');
      expect(charges[0]?.totalMinor).toBe(50_000);
      expect(charges[0]?.appointmentServiceId).not.toBeNull();

      const reopened = await setStatus(appointmentId, 'in_progress');
      expect(reopened.status).toBe(200);

      const open = await listCharges('?status=open');
      expect((open.body as { data: ChargeBody[] }).data).toHaveLength(0);

      const voided = await listCharges('?status=void');
      expect((voided.body as { data: ChargeBody[] }).data).toHaveLength(1);
    });

    it('aynı randevu iki kez tamamlanırsa borç İKİ KEZ yazılmaz', async () => {
      const created = await createAppointment(at('11:00'));
      const appointmentId = (created.body as { id: string }).id;

      await complete(appointmentId);
      await setStatus(appointmentId, 'in_progress');
      await setStatus(appointmentId, 'completed');

      const open = await listCharges('?status=open');
      expect((open.body as { data: ChargeBody[] }).data).toHaveLength(1);
    });

    it('paketten karşılanan kalem için borç YAZILMAZ', async () => {
      const definition = await createPackageDefinition(app, clinic.owner.tokens, {
        slug: 'bakim-5',
        name: '5 Bakım',
        totalPriceMinor: 200_000,
        items: [{ serviceId: clinic.quickService.id, quantity: 5 }],
      });
      const pkg = await sellPackage(app, clinic.owner.tokens, clinic.branch.id, {
        customerId: clinic.customer.id,
        definitionId: definition.id,
      });

      const created = await createAppointment(at('12:00'));
      const appointmentId = (created.body as { id: string }).id;
      const detail = await http(app)
        .get(`/api/v1/appointments/${appointmentId}`)
        .set(ownerAuth())
        .set(branch());
      const appointmentServiceId = (
        detail.body as { services: { id: string }[] }
      ).services[0]?.id;

      const bind = await http(app)
        .post(`/api/v1/appointments/${appointmentId}/consume-package`)
        .set(ownerAuth())
        .set(branch())
        .send({
          lines: [
            {
              appointmentServiceId,
              customerPackageItemId: pkg.items[0]?.id,
            },
          ],
        });
      expect(bind.status).toBe(200);

      const before = await listCharges('?source=appointment_service');
      expect((before.body as { data: ChargeBody[] }).data).toHaveLength(0);

      await complete(appointmentId);

      const after = await listCharges('?source=appointment_service');
      expect((after.body as { data: ChargeBody[] }).data).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('paketten doğan borç', () => {
    it('satış kalem başına borç yazar; toplam satış fiyatına eşittir', async () => {
      const definition = await createPackageDefinition(app, clinic.owner.tokens, {
        slug: 'lazer-10-bakim-2',
        name: '10 Lazer + 2 Bakım',
        totalPriceMinor: 1_200_000,
        items: [
          { serviceId: clinic.service.id, quantity: 10 },
          { serviceId: clinic.quickService.id, quantity: 2 },
        ],
      });
      const pkg = await sellPackage(app, clinic.owner.tokens, clinic.branch.id, {
        customerId: clinic.customer.id,
        definitionId: definition.id,
      });

      const res = await listCharges('?source=package_sale');
      const charges = (res.body as { data: ChargeBody[] }).data;
      expect(charges).toHaveLength(2);
      expect(charges.every((row) => row.customerPackageId === pkg.id)).toBe(true);

      // Borç toplamı, KAMPANYALI satış fiyatına eşit — liste fiyatına değil.
      const total = charges.reduce((sum, row) => sum + row.totalMinor, 0);
      expect(total).toBe(1_200_000);
    });

    it('iade NEGATİF borç kalemi doğurur ve cari bakiyeyi düşürür', async () => {
      const definition = await createPackageDefinition(app, clinic.owner.tokens, {
        slug: 'bakim-4',
        name: '4 Bakım',
        totalPriceMinor: 200_000,
        items: [{ serviceId: clinic.quickService.id, quantity: 4 }],
      });
      const pkg = await sellPackage(app, clinic.owner.tokens, clinic.branch.id, {
        customerId: clinic.customer.id,
        definitionId: definition.id,
      });

      const before = await account();
      expect((before.body as AccountBody).chargedMinor).toBe(200_000);

      const refund = await http(app)
        .post(`/api/v1/customer-packages/${pkg.id}/refund`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${pkg.version}"` })
        .send({ reason: 'Müşteri talebi' });
      expect(refund.status).toBe(200);

      const negative = await listCharges('?source=package_refund');
      const rows = (negative.body as { data: ChargeBody[] }).data;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.totalMinor).toBe(-200_000);

      const after = await account();
      expect((after.body as AccountBody).balanceMinor).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('cari hesap', () => {
    it('bakiye borç satırlarından TÜRETİLİR ve iptal edilen kalem sayılmaz', async () => {
      const first = await http(app)
        .post('/api/v1/charges')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          source: 'manual',
          description: 'Kalem A',
          unitPriceMinor: 30_000,
        });
      const second = await http(app)
        .post('/api/v1/charges')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          source: 'manual',
          description: 'Kalem B',
          unitPriceMinor: 70_000,
        });

      const before = await account();
      expect((before.body as AccountBody).chargedMinor).toBe(100_000);
      expect((before.body as AccountBody).paidMinor).toBe(0);
      expect((before.body as AccountBody).balanceMinor).toBe(100_000);
      expect((before.body as AccountBody).entries).toHaveLength(2);

      const firstBody = first.body as ChargeBody;
      await http(app)
        .post(`/api/v1/charges/${firstBody.id}/void`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${firstBody.version}"` })
        .send({ reason: 'Yanlış kalem' })
        .expect(200);

      const after = await account();
      expect((after.body as AccountBody).balanceMinor).toBe(70_000);
      expect((after.body as AccountBody).entries).toHaveLength(1);
      void second;
    });

    it('iptal edilmiş kalem düzeltilemez', async () => {
      const created = await http(app)
        .post('/api/v1/charges')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          source: 'manual',
          description: 'Kalem',
          unitPriceMinor: 10_000,
        });
      const body = created.body as ChargeBody;

      const voided = await http(app)
        .post(`/api/v1/charges/${body.id}/void`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${body.version}"` })
        .send({ reason: 'Yanlış kalem' });
      expect(voided.status).toBe(200);

      const patch = await http(app)
        .patch(`/api/v1/charges/${body.id}`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${(voided.body as ChargeBody).version}"` })
        .send({ description: 'Düzeltme' });
      expect(patch.status).toBe(409);
      expect((patch.body as Problem).code).toBe('CONFLICT');
    });

    /**
     * Regresyon: `customer_account_entries` bir VIEW ve view'lar varsayılanda
     * SAHİBİNİN yetkisiyle çalışır. Sahibi `klinara_owner` ve o rol BYPASSRLS
     * olduğu için, `security_invoker` bayrağı olmadan bu uç tüm kiracıların
     * satırlarını toplardı. Delik geliştirme sırasında gerçekten açıktı.
     */
    it('cari hesap BAŞKA kiracının borcunu toplamaz', async () => {
      await http(app)
        .post('/api/v1/charges')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          source: 'manual',
          description: 'Kalem',
          unitPriceMinor: 40_000,
        })
        .expect(201);

      const other = await setupClinic(app, { slug: 'ikinci-klinik' });
      const response = await http(app)
        .get(`/api/v1/customers/${clinic.customer.id}/account`)
        .set(auth(other.owner.tokens));

      expect(response.status).toBe(200);
      expect((response.body as AccountBody).chargedMinor).toBe(0);
      expect((response.body as AccountBody).entries).toHaveLength(0);
    });

    it('ücret kalemi SİLİNEMEZ — uygulama rolünde delete yetkisi yok', async () => {
      await expect(
        database.appPool.query('delete from charges'),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
