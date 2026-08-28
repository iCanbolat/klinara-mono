import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';

interface ChargeBody {
  id: string;
  totalMinor: number;
  version: number;
  description: string;
}

interface PaymentBody {
  id: string;
  amountMinor: number;
  allocatedMinor: number;
  unallocatedMinor: number;
  receiptNo: number;
  status: string;
  version: number;
  allocations: { chargeId: string; amountMinor: number }[];
}

interface AccountBody {
  chargedMinor: number;
  paidMinor: number;
  balanceMinor: number;
}

interface Problem {
  code: string;
  status: number;
}

describe('tahsilat ve dağıtım (Batch 6.2)', () => {
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

  const createCharge = async (
    amountMinor: number,
    description = 'Kalem',
  ): Promise<ChargeBody> => {
    const res = await http(app)
      .post('/api/v1/charges')
      .set(ownerAuth())
      .set(branch())
      .send({
        customerId: clinic.customer.id,
        source: 'manual',
        description,
        unitPriceMinor: amountMinor,
      });
    if (res.status !== 201) throw new Error(`Kalem açılamadı: ${res.status} ${res.text}`);
    return res.body as ChargeBody;
  };

  const pay = (body: Record<string, unknown>) =>
    http(app)
      .post('/api/v1/payments')
      .set(ownerAuth())
      .set(branch())
      .send({ customerId: clinic.customer.id, method: 'card', ...body });

  const account = () =>
    http(app).get(`/api/v1/customers/${clinic.customer.id}/account`).set(ownerAuth());

  // -------------------------------------------------------------------------
  describe('dağıtım', () => {
    it('tek tahsilat birden çok kaleme KISMİ dağıtılır', async () => {
      const first = await createCharge(30_000, 'Kalem A');
      const second = await createCharge(70_000, 'Kalem B');

      const res = await pay({
        amountMinor: 50_000,
        allocations: [
          { chargeId: first.id, amountMinor: 30_000 },
          { chargeId: second.id, amountMinor: 20_000 },
        ],
      });

      expect(res.status).toBe(201);
      const body = res.body as PaymentBody;
      expect(body.allocatedMinor).toBe(50_000);
      expect(body.unallocatedMinor).toBe(0);
      expect(body.allocations).toHaveLength(2);

      const acc = await account();
      expect((acc.body as AccountBody).chargedMinor).toBe(100_000);
      expect((acc.body as AccountBody).paidMinor).toBe(50_000);
      expect((acc.body as AccountBody).balanceMinor).toBe(50_000);
    });

    it('dağıtım verilmezse açık kalemlere ESKİDEN YENİYE dağıtılır', async () => {
      const first = await createCharge(30_000, 'Eski');
      const second = await createCharge(70_000, 'Yeni');

      const res = await pay({ amountMinor: 50_000 });
      expect(res.status).toBe(201);

      const body = res.body as PaymentBody;
      expect(body.allocations).toHaveLength(2);
      expect(body.allocations[0]).toMatchObject({ chargeId: first.id, amountMinor: 30_000 });
      expect(body.allocations[1]).toMatchObject({ chargeId: second.id, amountMinor: 20_000 });
    });

    it('borçtan fazla ödenirse artan tutar AVANS olarak kalır', async () => {
      await createCharge(20_000);

      const res = await pay({ amountMinor: 50_000 });
      expect(res.status).toBe(201);

      const body = res.body as PaymentBody;
      expect(body.allocatedMinor).toBe(20_000);
      expect(body.unallocatedMinor).toBe(30_000);

      // Avans cari bakiyeye yansır: müşteri 30.000 alacaklı.
      const acc = await account();
      expect((acc.body as AccountBody).balanceMinor).toBe(-30_000);
    });
  });

  // -------------------------------------------------------------------------
  describe('tavan kuralları', () => {
    it('bir kaleme tutarından fazla tahsis PAYMENT_EXCEEDS_BALANCE verir', async () => {
      const charge = await createCharge(30_000);

      const res = await pay({
        amountMinor: 50_000,
        allocations: [{ chargeId: charge.id, amountMinor: 50_000 }],
      });

      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('PAYMENT_EXCEEDS_BALANCE');
    });

    it('iki ayrı tahsilat birlikte kalemin tutarını aşamaz', async () => {
      const charge = await createCharge(30_000);

      const first = await pay({
        amountMinor: 20_000,
        allocations: [{ chargeId: charge.id, amountMinor: 20_000 }],
      });
      expect(first.status).toBe(201);

      const second = await pay({
        amountMinor: 20_000,
        allocations: [{ chargeId: charge.id, amountMinor: 20_000 }],
      });
      expect(second.status).toBe(409);
      expect((second.body as Problem).code).toBe('PAYMENT_EXCEEDS_BALANCE');
    });

    it('dağıtım toplamı tahsilat tutarını aşamaz', async () => {
      const first = await createCharge(30_000);
      const second = await createCharge(30_000);

      const res = await pay({
        amountMinor: 40_000,
        allocations: [
          { chargeId: first.id, amountMinor: 30_000 },
          { chargeId: second.id, amountMinor: 30_000 },
        ],
      });

      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('PAYMENT_EXCEEDS_BALANCE');
    });

    it('başka müşterinin kalemine tahsis edilemez', async () => {
      const other = await http(app)
        .post('/api/v1/customers')
        .set(ownerAuth())
        .send({ fullName: 'Diğer Müşteri', phone: '+905321112233' });
      const otherId = (other.body as { id: string }).id;

      const foreign = await http(app)
        .post('/api/v1/charges')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: otherId,
          source: 'manual',
          description: 'Yabancı kalem',
          unitPriceMinor: 10_000,
        });

      const res = await pay({
        amountMinor: 10_000,
        allocations: [{ chargeId: (foreign.body as ChargeBody).id, amountMinor: 10_000 }],
      });

      expect(res.status).toBe(422);
    });

    it('iptal edilmiş kaleme tahsis edilemez', async () => {
      const charge = await createCharge(30_000);
      await http(app)
        .post(`/api/v1/charges/${charge.id}/void`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${charge.version}"` })
        .send({ reason: 'Yanlış kalem' })
        .expect(200);

      const res = await pay({
        amountMinor: 30_000,
        allocations: [{ chargeId: charge.id, amountMinor: 30_000 }],
      });
      expect(res.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('makbuz numarası', () => {
    it('BOŞLUKSUZ artar', async () => {
      await createCharge(100_000);

      const numbers: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const res = await pay({ amountMinor: 1_000 });
        numbers.push((res.body as PaymentBody).receiptNo);
      }
      expect(numbers).toEqual([1, 2, 3]);
    });

    it('eş zamanlı 10 tahsilatta çakışmaz ve boşluk bırakmaz', async () => {
      await createCharge(1_000_000);

      const results = await Promise.all(
        Array.from({ length: 10 }, () => pay({ amountMinor: 10_000 })),
      );
      expect(results.every((res) => res.status === 201)).toBe(true);

      const numbers = results
        .map((res) => (res.body as PaymentBody).receiptNo)
        .sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('makbuz numarası kiracı bazlıdır', async () => {
      await createCharge(50_000);
      const first = await pay({ amountMinor: 10_000 });
      expect((first.body as PaymentBody).receiptNo).toBe(1);

      const other = await setupClinic(app, { slug: 'ikinci-klinik' });
      const otherPayment = await http(app)
        .post('/api/v1/payments')
        .set(auth(other.owner.tokens))
        .set(branchHeader(other.branch.id))
        .send({ customerId: other.customer.id, method: 'card', amountMinor: 5_000 });

      expect(otherPayment.status).toBe(201);
      expect((otherPayment.body as PaymentBody).receiptNo).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('iptal', () => {
    it('iptal bakiyeyi geri getirir ama tahsis satırlarını SİLMEZ', async () => {
      const charge = await createCharge(50_000);
      const paid = await pay({
        amountMinor: 50_000,
        allocations: [{ chargeId: charge.id, amountMinor: 50_000 }],
      });
      const payment = paid.body as PaymentBody;

      const before = await account();
      expect((before.body as AccountBody).balanceMinor).toBe(0);

      const voided = await http(app)
        .post(`/api/v1/payments/${payment.id}/void`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${payment.version}"` })
        .send({ reason: 'Yanlış tahsilat' });
      expect(voided.status).toBe(200);
      expect((voided.body as PaymentBody).status).toBe('void');

      const after = await account();
      expect((after.body as AccountBody).balanceMinor).toBe(50_000);
      expect((after.body as AccountBody).paidMinor).toBe(0);

      // Satır DURUYOR: "para hiç girmedi" ile "girdi, iade edildi" farklıdır.
      const rows = await database.ownerPool.query<{ count: string }>(
        'select count(*)::text as count from payment_allocations where payment_id = $1',
        [payment.id],
      );
      expect(Number(rows.rows[0]?.count)).toBe(1);
    });

    it('iptal sonrası kalem yeniden tahsil edilebilir', async () => {
      const charge = await createCharge(50_000);
      const paid = await pay({
        amountMinor: 50_000,
        allocations: [{ chargeId: charge.id, amountMinor: 50_000 }],
      });
      const payment = paid.body as PaymentBody;

      await http(app)
        .post(`/api/v1/payments/${payment.id}/void`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${payment.version}"` })
        .send({ reason: 'Yanlış tahsilat' })
        .expect(200);

      const again = await pay({
        amountMinor: 50_000,
        allocations: [{ chargeId: charge.id, amountMinor: 50_000 }],
      });
      expect(again.status).toBe(201);
    });

    it('tahsilat yapılmış ücret kalemi İPTAL EDİLEMEZ', async () => {
      const charge = await createCharge(50_000);
      await pay({
        amountMinor: 20_000,
        allocations: [{ chargeId: charge.id, amountMinor: 20_000 }],
      });

      const res = await http(app)
        .post(`/api/v1/charges/${charge.id}/void`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${charge.version}"` })
        .send({ reason: 'Yanlış kalem' });

      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CONFLICT');
    });
  });

  // -------------------------------------------------------------------------
  describe('değişmezlik ve izolasyon', () => {
    it('tahsis satırı UPDATE/DELETE edilemez', async () => {
      const charge = await createCharge(10_000);
      await pay({
        amountMinor: 10_000,
        allocations: [{ chargeId: charge.id, amountMinor: 10_000 }],
      });

      await expect(
        database.appPool.query('update payment_allocations set amount_minor = 1'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        database.appPool.query('delete from payment_allocations'),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('başka kiracının tahsilatı görünmez', async () => {
      await createCharge(10_000);
      const paid = await pay({ amountMinor: 10_000 });
      const other = await setupClinic(app, { slug: 'ikinci-klinik' });

      const res = await http(app)
        .get(`/api/v1/payments/${(paid.body as PaymentBody).id}`)
        .set(auth(other.owner.tokens));
      expect(res.status).toBe(404);
    });
  });
});
