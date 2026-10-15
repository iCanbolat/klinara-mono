import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import {
  auth,
  bootstrapTenant,
  http,
  inviteMember,
  PLATFORM_TOKEN,
  supportReason,
  type TenantFixture,
} from '../helpers/identity';
import { MAIL_SENDER } from '../../src/lib/mail/mail.types';
import type { LogMailSender } from '../../src/lib/mail/mail.module';

interface Problem {
  code: string;
  status: number;
  limit?: number;
  used?: number;
  planKey?: string;
}

const platform = () => ({ authorization: `Bearer ${PLATFORM_TOKEN}`, ...supportReason() });

/**
 * Plan limitleri, platform yöneticisi uçları ve kiracı askıya alma.
 *
 * Planlar `packages/shared/src/plans.ts`te; limit yalnız YENİ ekleme ve
 * pasiften aktife almada uygulanır.
 */
describe('plan limitleri ve platform yönetimi', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
        PLATFORM_ADMIN_TOKEN_NOT_AFTER: '2099-01-01T00:00:00Z',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
  });

  const createStaff = async (clinic: TenantFixture, email: string) => {
    const member = await inviteMember(app, clinic.owner.tokens, {
      email,
      roleKey: 'practitioner',
      branchId: clinic.branch.id,
    });
    return http(app)
      .post('/api/v1/staff')
      .set(auth(clinic.owner.tokens))
      .send({ userId: member.userId, primaryBranchId: clinic.branch.id });
  };

  it('Başlangıç planında ikinci şube 409 PLAN_BRANCH_LIMIT_REACHED döner', async () => {
    const clinic = await bootstrapTenant(app, {
      slug: 'baslangic-klinik',
      plan: { planKey: 'baslangic' },
    });

    const res = await http(app)
      .post('/api/v1/branches')
      .set(auth(clinic.owner.tokens))
      .send({ slug: 'ikinci', name: 'İkinci Şube' });

    expect(res.status).toBe(409);
    const problem = res.body as Problem;
    expect(problem.code).toBe('PLAN_BRANCH_LIMIT_REACHED');
    expect(problem.limit).toBe(1);
    expect(problem.used).toBe(1);
  });

  it('hekim limiti aktif profilleri sayar; pasif profili yeniden açmak da limite takılır', async () => {
    const clinic = await bootstrapTenant(app, {
      slug: 'iki-hekim',
      plan: { planKey: 'baslangic' },
    });

    const first = await createStaff(clinic, 'h1@iki-hekim.test');
    const second = await createStaff(clinic, 'h2@iki-hekim.test');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const third = await createStaff(clinic, 'h3@iki-hekim.test');
    expect(third.status).toBe(409);
    expect((third.body as Problem).code).toBe('PLAN_PRACTITIONER_LIMIT_REACHED');

    // Birini pasife al → yer açılır; üçüncü eklenir; pasifi geri açmak reddedilir.
    const firstId = (first.body as { id: string }).id;
    const off = await http(app)
      .patch(`/api/v1/staff/${firstId}`)
      .set(auth(clinic.owner.tokens))
      .send({ isActive: false });
    expect(off.status).toBe(200);

    const member = await inviteMember(app, clinic.owner.tokens, {
      email: 'h4@iki-hekim.test',
      roleKey: 'practitioner',
      branchId: clinic.branch.id,
    });
    const fourth = await http(app)
      .post('/api/v1/staff')
      .set(auth(clinic.owner.tokens))
      .send({ userId: member.userId, primaryBranchId: clinic.branch.id });
    expect(fourth.status).toBe(201);

    const reopen = await http(app)
      .patch(`/api/v1/staff/${firstId}`)
      .set(auth(clinic.owner.tokens))
      .send({ isActive: true });
    expect(reopen.status).toBe(409);

    const plan = await http(app).get('/api/v1/tenant/plan').set(auth(clinic.owner.tokens));
    expect(plan.status).toBe(200);
    expect(plan.body).toEqual({
      planKey: 'baslangic',
      planName: 'Başlangıç',
      limits: { maxBranches: 1, maxPractitioners: 2 },
      usage: { branches: 1, practitioners: 2 },
    });
  });

  it('platform override’ı limiti genişletir; liste ve detay kullanımı gösterir', async () => {
    const clinic = await bootstrapTenant(app, {
      slug: 'ozel-klinik',
      plan: { planKey: 'baslangic' },
    });

    const patched = await http(app)
      .patch(`/api/v1/platform/tenants/${clinic.tenant.id}`)
      .set(platform())
      .send({ planKey: 'ozel', maxBranchesOverride: 5, planNote: 'pilot müşteri' });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      planKey: 'ozel',
      limits: { maxBranches: 5, maxPractitioners: 25 },
      planNote: 'pilot müşteri',
      ownerInvitation: { state: 'accepted' },
    });

    const branch = await http(app)
      .post('/api/v1/branches')
      .set(auth(clinic.owner.tokens))
      .send({ slug: 'ikinci', name: 'İkinci Şube' });
    expect(branch.status).toBe(201);

    const list = await http(app).get('/api/v1/platform/tenants').set(platform());
    expect(list.status).toBe(200);
    const row = (list.body as { data: { id: string; usage: { branches: number } }[] }).data.find(
      (t) => t.id === clinic.tenant.id,
    );
    expect(row?.usage.branches).toBe(2);

    const detail = await http(app)
      .get(`/api/v1/platform/tenants/${clinic.tenant.id}`)
      .set(platform());
    expect(detail.status).toBe(200);
    const setup = (
      detail.body as { setup: { steps: { key: string; done: boolean }[]; complete: boolean } }
    ).setup;
    expect(setup.complete).toBe(false);
    expect(setup.steps.find((s) => s.key === 'branch')?.done).toBe(true);
    expect(setup.steps.find((s) => s.key === 'whatsapp')?.done).toBe(false);
  });

  it('kiracı kendi planını PATCH /tenant ile değiştiremez', async () => {
    const clinic = await bootstrapTenant(app, {
      slug: 'kendi-plani',
      plan: { planKey: 'baslangic' },
    });
    const res = await http(app)
      .patch('/api/v1/tenant')
      .set(auth(clinic.owner.tokens))
      .send({ status: 'active', planKey: 'cok-subeli' });
    // Bilinmeyen alanlar doğrulamada elenir; plan ve durum değişmez.
    expect(res.status).toBe(200);
    const tenant = await http(app).get('/api/v1/tenant').set(auth(clinic.owner.tokens));
    expect((tenant.body as { status: string }).status).toBe('trial');
    const plan = await http(app).get('/api/v1/tenant/plan').set(auth(clinic.owner.tokens));
    expect((plan.body as { planKey: string }).planKey).toBe('baslangic');

    // Veritabanı kilidi: kiracı context'inde plan kolonu güncellenemez.
    const client = await database.appPool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [clinic.tenant.id]);
      await expect(
        client.query(`update tenants set plan_key = 'ozel' where id = $1`, [clinic.tenant.id]),
      ).rejects.toThrow(/platform yöneticisi/);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('askıya alınan kiracıda istekler 403 TENANT_SUSPENDED döner; askı kalkınca çalışır', async () => {
    const clinic = await bootstrapTenant(app, { slug: 'askida' });

    const suspend = await http(app)
      .patch(`/api/v1/platform/tenants/${clinic.tenant.id}`)
      .set(platform())
      .send({ status: 'suspended' });
    expect(suspend.status).toBe(200);

    const blocked = await http(app).get('/api/v1/me').set(auth(clinic.owner.tokens));
    expect(blocked.status).toBe(403);
    expect((blocked.body as Problem).code).toBe('TENANT_SUSPENDED');

    await http(app)
      .patch(`/api/v1/platform/tenants/${clinic.tenant.id}`)
      .set(platform())
      .send({ status: 'active' });
    const ok = await http(app).get('/api/v1/me').set(auth(clinic.owner.tokens));
    expect(ok.status).toBe(200);
  });

  it('sahip davetini yeniden gönderir: eskisi iptal, yenisi e-postayla gider', async () => {
    const created = await http(app)
      .post('/api/v1/platform/tenants')
      .set(platform())
      .send({
        slug: 'davet-bekleyen',
        name: 'Lale Klinik',
        branch: { slug: 'merkez', name: 'Merkez' },
        owner: { email: 'sahip@lale.test' },
      });
    expect(created.status).toBe(201);
    const first = created.body as {
      tenant: { id: string };
      ownerInvitation: { token: string; mailDelivered: boolean };
    };
    expect(first.ownerInvitation.mailDelivered).toBe(true);

    const mail = app.get<LogMailSender>(MAIL_SENDER);
    expect(mail.sent.at(-1)?.subject).toBe("Lale Klinik sizi Klinara'ya davet etti");

    const resent = await http(app)
      .post(`/api/v1/platform/tenants/${first.tenant.id}/owner-invitation`)
      .set(platform())
      .send({});
    expect(resent.status).toBe(201);
    expect(resent.body).toMatchObject({ email: 'sahip@lale.test', mailDelivered: true });
    expect(mail.sent.at(-1)?.body).toContain((resent.body as { link: string }).link);

    // Eski bağlantı artık geçersiz.
    const old = await http(app).get(`/api/v1/invitations/token/${first.ownerInvitation.token}`);
    expect(old.status).not.toBe(200);
  });

  it('platform uçları gerekçesiz çağrıyı reddeder', async () => {
    const res = await http(app)
      .get('/api/v1/platform/tenants')
      .set('authorization', `Bearer ${PLATFORM_TOKEN}`);
    expect(res.status).toBe(403);
  });

  it('parola sıfırlama e-postası /parola/sifirla?token= bağlantısını taşır', async () => {
    const clinic = await bootstrapTenant(app, { slug: 'parola-klinik' });
    const res = await http(app)
      .post('/api/v1/auth/password/forgot')
      .send({ email: clinic.owner.email });
    expect(res.status).toBeLessThan(300);

    const mail = app.get<LogMailSender>(MAIL_SENDER);
    const last = mail.sent.at(-1);
    expect(last?.subject).toBe('Klinara parola sıfırlama');
    expect(last?.body).toMatch(/\/parola\/sifirla\?token=[^\s]+/);
    expect(last?.html).toContain('/parola/sifirla?token=');
  });
});
