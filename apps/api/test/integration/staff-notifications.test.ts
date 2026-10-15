import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { TenantTxService } from '../../src/database/tenant-tx.service';
import { StaffNotificationsService } from '../../src/modules/notifications/staff-notifications.service';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';

interface FeedBody {
  data: { id: string; kind: string; title: string; readAt: string | null }[];
  unreadCount: number;
}

describe('personel bildirim merkezi', () => {
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

  const emit = (title: string) =>
    app.get(TenantTxService).runForTenant(clinic.tenant.id, (tx) =>
      app.get(StaffNotificationsService).emit(tx, {
        tenantId: clinic.tenant.id,
        kind: 'inbound_message',
        title,
      }),
    );

  const feed = async (): Promise<FeedBody> => {
    const res = await http(app)
      .get('/api/v1/staff-notifications')
      .set(ownerAuth())
      .expect(200);
    return res.body as FeedBody;
  };

  it('akış en yeniden eskiye döner ve okunmamışları sayar', async () => {
    await emit('birinci');
    await emit('ikinci');

    const body = await feed();
    expect(body.data.map((row) => row.title)).toEqual(['ikinci', 'birinci']);
    expect(body.unreadCount).toBe(2);
    expect(body.data[0]?.readAt).toBeNull();
  });

  it('seçili bildirim okundu işaretlenir; ötekiler sayaçta kalır', async () => {
    await emit('birinci');
    await emit('ikinci');
    const before = await feed();

    await http(app)
      .post('/api/v1/staff-notifications/read')
      .set(ownerAuth())
      .send({ ids: [before.data[0]?.id] })
      .expect(204);

    const after = await feed();
    expect(after.unreadCount).toBe(1);
    expect(after.data[0]?.readAt).not.toBeNull();
  });

  it('`ids` verilmezse tümü okundu sayılır', async () => {
    await emit('birinci');
    await emit('ikinci');

    await http(app)
      .post('/api/v1/staff-notifications/read')
      .set(ownerAuth())
      .send({})
      .expect(204);

    expect((await feed()).unreadCount).toBe(0);
  });

  const inviteReceptionist = () =>
    inviteMember(app, clinic.owner.tokens, {
      email: 'resepsiyon@klinik.test',
      roleKey: 'receptionist',
      branchId: clinic.branch.id,
    });

  const feedOf = async (tokens: Parameters<typeof auth>[0]): Promise<FeedBody> =>
    (await http(app).get('/api/v1/staff-notifications').set(auth(tokens)).expect(200))
      .body as FeedBody;

  it('okundu bilgisi KİŞİSEL: başka kullanıcının sayacı düşmez', async () => {
    const desk = await inviteReceptionist();
    await emit('birinci');
    await http(app)
      .post('/api/v1/staff-notifications/read')
      .set(ownerAuth())
      .send({})
      .expect(204);

    expect((await feedOf(desk.tokens)).unreadCount).toBe(1);
  });

  it('gelen WhatsApp mesajını mesajlaşma izni olmayan uygulayıcı görmez', async () => {
    const desk = await inviteReceptionist();
    await emit('selam');
    expect((await feedOf(desk.tokens)).data.map((row) => row.title)).toEqual(['selam']);
    const practitioner = await feedOf(clinic.practitioner.tokens);
    expect(practitioner.data).toHaveLength(0);
    expect(practitioner.unreadCount).toBe(0);
  });

  it('şube kapsamlı kullanıcı başka şubenin bildirimini görmez', async () => {
    const desk = await inviteReceptionist();
    const created = await http(app)
      .post('/api/v1/branches')
      .set(ownerAuth())
      .send({ slug: 'kadikoy', name: 'Kadıköy' })
      .expect(201);
    const otherBranch = (created.body as { id: string }).id;
    await app.get(TenantTxService).runForTenant(clinic.tenant.id, (tx) =>
      app.get(StaffNotificationsService).emit(tx, {
        tenantId: clinic.tenant.id,
        branchId: otherBranch,
        kind: 'delivery_failed',
        title: 'kadıköy',
      }),
    );
    expect((await feed()).data.map((row) => row.title)).toEqual(['kadıköy']);
    expect((await feedOf(desk.tokens)).data).toHaveLength(0);
  });
});
