import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';
import { createPackageDefinition, sellPackage } from '../helpers/packages';

interface SessionBody {
  id: string;
  status: string;
  openingBalanceMinor: number;
  expectedMinor: number | null;
  countedMinor: number | null;
  differenceMinor: number | null;
  version: number;
}

interface SummaryBody {
  expectedMinor: number;
  byMethod: { method: string; amountMinor: number; count: number }[];
  movements: { kind: string; amountMinor: number }[];
}

interface Problem {
  code: string;
  status: number;
}

describe('kasa ve iade (Batch 6.3)', () => {
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

  const openSession = (openingBalanceMinor = 0) =>
    http(app)
      .post('/api/v1/cash-sessions/open')
      .set(ownerAuth())
      .set(branch())
      .send({ openingBalanceMinor });

  const closeSession = (id: string, version: number, body: Record<string, unknown>) =>
    http(app)
      .post(`/api/v1/cash-sessions/${id}/close`)
      .set(ownerAuth())
      .set({ 'if-match': `W/"${version}"` })
      .send(body);

  const createCharge = async (amountMinor: number): Promise<string> => {
    const res = await http(app)
      .post('/api/v1/charges')
      .set(ownerAuth())
      .set(branch())
      .send({
        customerId: clinic.customer.id,
        source: 'manual',
        description: 'Kalem',
        unitPriceMinor: amountMinor,
      });
    if (res.status !== 201) throw new Error(`Kalem açılamadı: ${res.status} ${res.text}`);
    return (res.body as { id: string }).id;
  };

  const pay = (amountMinor: number, method = 'cash') =>
    http(app)
      .post('/api/v1/payments')
      .set(ownerAuth())
      .set(branch())
      .send({ customerId: clinic.customer.id, method, amountMinor });

  // -------------------------------------------------------------------------
  describe('oturum yaşam döngüsü', () => {
    it('şube başına İKİNCİ kasa açılamaz', async () => {
      const first = await openSession(10_000);
      expect(first.status).toBe(201);

      const second = await openSession();
      expect(second.status).toBe(409);
      expect((second.body as Problem).code).toBe('CASH_SESSION_ALREADY_OPEN');
    });

    it('kapatıldıktan sonra yeni kasa açılabilir', async () => {
      const first = await openSession(10_000);
      const body = first.body as SessionBody;

      const closed = await closeSession(body.id, body.version, { countedMinor: 10_000 });
      expect(closed.status).toBe(200);
      expect((closed.body as SessionBody).status).toBe('closed');

      const second = await openSession();
      expect(second.status).toBe(201);
    });

    it('kapanmış kasa yeniden kapatılamaz', async () => {
      const opened = await openSession();
      const body = opened.body as SessionBody;
      const closed = await closeSession(body.id, body.version, { countedMinor: 0 });

      const again = await closeSession(
        body.id,
        (closed.body as SessionBody).version,
        { countedMinor: 0 },
      );
      expect(again.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('beklenen tutar ve sayım farkı', () => {
    it('beklenen tutar açılış + nakit hareketlerden HESAPLANIR', async () => {
      const opened = await openSession(50_000);
      const session = opened.body as SessionBody;

      await createCharge(30_000);
      await pay(30_000);

      const summary = await http(app)
        .get(`/api/v1/cash-sessions/${session.id}/summary`)
        .set(ownerAuth());
      expect(summary.status).toBe(200);
      expect((summary.body as SummaryBody).expectedMinor).toBe(80_000);

      const closed = await closeSession(session.id, session.version, {
        countedMinor: 80_000,
      });
      expect(closed.status).toBe(200);
      expect((closed.body as SessionBody).expectedMinor).toBe(80_000);
      expect((closed.body as SessionBody).differenceMinor).toBe(0);
    });

    it('fark varsa GEREKÇESİZ kapanış reddedilir', async () => {
      const opened = await openSession(50_000);
      const session = opened.body as SessionBody;

      const res = await closeSession(session.id, session.version, { countedMinor: 45_000 });
      expect(res.status).toBe(422);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');

      const withReason = await closeSession(session.id, session.version, {
        countedMinor: 45_000,
        differenceReason: 'Kasadan eksik çıktı, tutanak tutuldu',
      });
      expect(withReason.status).toBe(200);
      expect((withReason.body as SessionBody).differenceMinor).toBe(-5_000);
    });

    it('gün sonu özeti yöntem kırılımını verir', async () => {
      const opened = await openSession();
      const session = opened.body as SessionBody;

      await createCharge(100_000);
      await pay(30_000, 'cash');
      await pay(20_000, 'card');

      const summary = await http(app)
        .get(`/api/v1/cash-sessions/${session.id}/summary`)
        .set(ownerAuth());

      const body = summary.body as SummaryBody;
      const methods = Object.fromEntries(body.byMethod.map((row) => [row.method, row.amountMinor]));
      expect(methods['cash']).toBe(30_000);
      expect(methods['card']).toBe(20_000);
      // Kasada YALNIZ nakit durur.
      expect(body.expectedMinor).toBe(30_000);
    });
  });

  // -------------------------------------------------------------------------
  describe('kasasız nakit yok', () => {
    it('açık kasa olmadan NAKİT tahsilat reddedilir', async () => {
      await createCharge(30_000);

      const res = await pay(30_000, 'cash');
      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CASH_SESSION_REQUIRED');
    });

    it('kart tahsilatı kasasız geçer', async () => {
      await createCharge(30_000);

      const res = await pay(30_000, 'card');
      expect(res.status).toBe(201);
    });

    it('kapanmış kasadan sonra nakit tahsilat yine reddedilir', async () => {
      const opened = await openSession();
      const session = opened.body as SessionBody;
      await closeSession(session.id, session.version, { countedMinor: 0 });

      await createCharge(10_000);
      const res = await pay(10_000, 'cash');
      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CASH_SESSION_REQUIRED');
    });
  });

  // -------------------------------------------------------------------------
  describe('iade', () => {
    it('paket iadesi `pending` durumunu `settled`e çeker ve kasadan çıkar', async () => {
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

      const opened = await openSession(500_000);
      const session = opened.body as SessionBody;

      // 5.3 akışı: hak düşer, negatif ücret kalemi doğar, durum `pending`.
      const refunded = await http(app)
        .post(`/api/v1/customer-packages/${pkg.id}/refund`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${pkg.version}"` })
        .send({ reason: 'Müşteri talebi' });
      expect(refunded.status).toBe(200);

      const pending = await database.ownerPool.query<{ refund_settlement_status: string }>(
        'select refund_settlement_status from customer_packages where id = $1',
        [pkg.id],
      );
      expect(pending.rows[0]?.refund_settlement_status).toBe('pending');

      const negative = await http(app)
        .get('/api/v1/charges?source=package_refund')
        .set(ownerAuth());
      const chargeId = (negative.body as { data: { id: string }[] }).data[0]?.id;

      const res = await http(app)
        .post('/api/v1/refunds')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          kind: 'package',
          amountMinor: 200_000,
          method: 'cash',
          chargeId,
          customerPackageId: pkg.id,
          reason: 'Paket iadesi nakit ödendi',
        });

      expect(res.status).toBe(201);
      expect((res.body as { packageSettlementStatus: string }).packageSettlementStatus).toBe(
        'settled',
      );

      const settled = await database.ownerPool.query<{ refund_settlement_status: string }>(
        'select refund_settlement_status from customer_packages where id = $1',
        [pkg.id],
      );
      expect(settled.rows[0]?.refund_settlement_status).toBe('settled');

      // Kasadan NEGATİF hareketle çıkmış olmalı.
      const summary = await http(app)
        .get(`/api/v1/cash-sessions/${session.id}/summary`)
        .set(ownerAuth());
      const body = summary.body as SummaryBody;
      expect(body.expectedMinor).toBe(300_000);
      expect(body.movements.some((row) => row.kind === 'refund' && row.amountMinor === -200_000)).toBe(
        true,
      );
    });

    it('aynı negatif kalem İKİ KEZ iade edilemez', async () => {
      const definition = await createPackageDefinition(app, clinic.owner.tokens, {
        slug: 'bakim-2',
        name: '2 Bakım',
        totalPriceMinor: 100_000,
        items: [{ serviceId: clinic.quickService.id, quantity: 2 }],
      });
      const pkg = await sellPackage(app, clinic.owner.tokens, clinic.branch.id, {
        customerId: clinic.customer.id,
        definitionId: definition.id,
      });
      await openSession(500_000);

      await http(app)
        .post(`/api/v1/customer-packages/${pkg.id}/refund`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${pkg.version}"` })
        .send({ reason: 'Müşteri talebi' })
        .expect(200);

      const negative = await http(app)
        .get('/api/v1/charges?source=package_refund')
        .set(ownerAuth());
      const chargeId = (negative.body as { data: { id: string }[] }).data[0]?.id;

      const settle = () =>
        http(app)
          .post('/api/v1/refunds')
          .set(ownerAuth())
          .set(branch())
          .send({
            customerId: clinic.customer.id,
            kind: 'package',
            amountMinor: 100_000,
            method: 'cash',
            chargeId,
            customerPackageId: pkg.id,
            reason: 'Paket iadesi nakit ödendi',
          });

      expect((await settle()).status).toBe(201);

      const second = await settle();
      expect(second.status).toBe(409);
      expect((second.body as Problem).code).toBe('CONFLICT');
    });

    it('iade tutarı negatif kalemin tutarını AŞAMAZ', async () => {
      const definition = await createPackageDefinition(app, clinic.owner.tokens, {
        slug: 'bakim-3',
        name: '3 Bakım',
        totalPriceMinor: 150_000,
        items: [{ serviceId: clinic.quickService.id, quantity: 3 }],
      });
      const pkg = await sellPackage(app, clinic.owner.tokens, clinic.branch.id, {
        customerId: clinic.customer.id,
        definitionId: definition.id,
      });
      await openSession(500_000);

      await http(app)
        .post(`/api/v1/customer-packages/${pkg.id}/refund`)
        .set(ownerAuth())
        .set({ 'if-match': `W/"${pkg.version}"` })
        .send({ reason: 'Müşteri talebi' })
        .expect(200);

      const negative = await http(app)
        .get('/api/v1/charges?source=package_refund')
        .set(ownerAuth());
      const chargeId = (negative.body as { data: { id: string }[] }).data[0]?.id;

      const res = await http(app)
        .post('/api/v1/refunds')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          kind: 'package',
          amountMinor: 200_000,
          method: 'cash',
          chargeId,
          customerPackageId: pkg.id,
          reason: 'Fazla iade denemesi',
        });

      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('PAYMENT_EXCEEDS_BALANCE');
    });

    it('açık kasa olmadan NAKİT iade reddedilir', async () => {
      const res = await http(app)
        .post('/api/v1/refunds')
        .set(ownerAuth())
        .set(branch())
        .send({
          customerId: clinic.customer.id,
          kind: 'other',
          amountMinor: 10_000,
          method: 'cash',
          reason: 'Kasasız iade denemesi',
        });

      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CASH_SESSION_REQUIRED');
    });
  });

  // -------------------------------------------------------------------------
  describe('değişmezlik', () => {
    it('kasa hareketi ve iade kaydı UPDATE/DELETE edilemez', async () => {
      const opened = await openSession(10_000);
      void opened;

      await expect(
        database.appPool.query('update cash_movements set amount_minor = 1'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        database.appPool.query('delete from refunds'),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
