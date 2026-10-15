import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import { TenantTxService } from '../../src/database/tenant-tx.service';
import type { RoutingPushSender } from '../../src/lib/push/push.module';
import { PUSH_SENDER } from '../../src/lib/push/push.types';
import * as pushRepo from '../../src/modules/notifications/push-devices.repository';
import { StaffNotificationsService } from '../../src/modules/notifications/staff-notifications.service';
import { StaffPushWorker } from '../../src/modules/notifications/staff-push.worker';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN, type Tokens } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';

describe('mobil push', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;
  let sender: RoutingPushSender;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: { DATABASE_URL: database.appUrl, PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN },
    });
    sender = app.get<RoutingPushSender>(PUSH_SENDER);
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    clinic = await setupClinic(app);
    sender.logged.splice(0);
  });

  const register = (tokens: Tokens, token: string, platform: 'ios' | 'android' = 'ios') =>
    http(app)
      .put('/api/v1/push-devices/current')
      .set(auth(tokens))
      .send({ platform, token, environment: 'sandbox' });

  /** Bildirimi yazar ve kuyruğun yapacağını doğrudan yapar (testte kuyruk kapalı). */
  const notifyAndPush = async (branchId: string | null = null): Promise<void> => {
    const tenantId = clinic.tenant.id;
    const tx = app.get(TenantTxService);
    const id = await tx.runForTenant(tenantId, async (t) => {
      await app.get(StaffNotificationsService).emit(t, {
        tenantId,
        branchId,
        kind: 'appointment_created',
        title: 'Online randevu oluşturuldu',
        body: 'Ayşe Yılmaz · Botoks · 09:00',
        appointmentId: null,
      });
      const result = await t.execute<{ id: string }>(
        sql`select id from staff_notifications order by created_at desc limit 1`,
      );
      return result.rows[0]?.id ?? '';
    });
    await app.get(StaffPushWorker).handle({ tenantId, notificationId: id });
  };

  it('kayıt kimlik ister', async () => {
    const res = await http(app)
      .put('/api/v1/push-devices/current')
      .send({ platform: 'ios', token: 'abc' });
    expect(res.status).toBe(401);
  });

  it('geçersiz platform reddedilir', async () => {
    const res = await http(app)
      .put('/api/v1/push-devices/current')
      .set(auth(clinic.owner.tokens))
      .send({ platform: 'windows', token: 'abc' });
    expect(res.status).toBe(400);
  });

  it('kayıtlı cihaza bildirim gider; metinde müşteri verisi yok', async () => {
    expect((await register(clinic.owner.tokens, 'owner-token')).status).toBe(204);
    await notifyAndPush();

    expect(sender.logged).toHaveLength(1);
    const [sent] = sender.logged;
    expect(sent?.device).toMatchObject({
      platform: 'ios',
      environment: 'sandbox',
      token: 'owner-token',
    });
    expect(sent?.message.title).toBe('Yeni online randevu');
    expect(JSON.stringify(sent?.message)).not.toContain('Ayşe');
    expect(JSON.stringify(sent?.message)).not.toContain('Botoks');
    expect(sent?.message.data).toEqual({ kind: 'appointment_created' });
  });

  it('aynı anahtarı başka kullanıcı kaydederse cihaz ona geçer', async () => {
    await register(clinic.owner.tokens, 'shared-phone').expect(204);
    await register(clinic.practitioner.tokens, 'shared-phone').expect(204);

    const devices = await app
      .get(TenantTxService)
      .runForTenant(clinic.tenant.id, (tx) => pushRepo.recipients(tx, { branchId: null, kind: 'appointment_created', appointmentId: null }));
    expect(devices).toHaveLength(1);

    await notifyAndPush();
    expect(sender.logged).toHaveLength(1);
  });

  it('oturum yeni anahtar alınca eskisi düşer', async () => {
    await register(clinic.owner.tokens, 'old-token').expect(204);
    await register(clinic.owner.tokens, 'new-token').expect(204);
    await notifyAndPush();
    expect(sender.logged.map((row) => row.device.token)).toEqual(['new-token']);
  });

  it('çıkış yapan oturumun cihazına gitmez', async () => {
    await register(clinic.owner.tokens, 'owner-token').expect(204);
    await http(app)
      .post('/api/v1/auth/logout')
      .set(auth(clinic.owner.tokens))
      .send({ refreshToken: clinic.owner.tokens.refreshToken });
    await notifyAndPush();
    expect(sender.logged).toHaveLength(0);
  });

  it('DELETE kaydı siler', async () => {
    await register(clinic.owner.tokens, 'owner-token').expect(204);
    await http(app)
      .delete('/api/v1/push-devices/current')
      .set(auth(clinic.owner.tokens))
      .expect(204);
    await notifyAndPush();
    expect(sender.logged).toHaveLength(0);
  });

  it('şube süzgeci: başka şubenin bildirimi şube personeline gitmez', async () => {
    await register(clinic.owner.tokens, 'owner-token').expect(204);
    await register(clinic.practitioner.tokens, 'practitioner-token', 'android').expect(204);

    const tx = app.get(TenantTxService);
    const own = await tx.runForTenant(clinic.tenant.id, (t) =>
      pushRepo.recipients(t, { branchId: clinic.branch.id, kind: 'appointment_created', appointmentId: null }),
    );
    expect(own.map((row) => row.token).sort()).toEqual(['owner-token', 'practitioner-token']);

    // Uygulayıcı yalnız kendi şubesinde; klinik geneli sahip her şubeyi görür.
    const other = await tx.runForTenant(clinic.tenant.id, (t) =>
      pushRepo.recipients(t, { branchId: randomUUID(), kind: 'appointment_created', appointmentId: null }),
    );
    expect(other.map((row) => row.token)).toEqual(['owner-token']);
  });

  it('gelen WhatsApp mesajı mesajlaşma izni olmayan uygulayıcıya gitmez', async () => {
    await register(clinic.owner.tokens, 'owner-token').expect(204);
    await register(clinic.practitioner.tokens, 'practitioner-token', 'android').expect(204);
    const devices = await app
      .get(TenantTxService)
      .runForTenant(clinic.tenant.id, (t) =>
        pushRepo.recipients(t, { branchId: null, kind: 'inbound_message', appointmentId: null }),
      );
    expect(devices.map((row) => row.token)).toEqual(['owner-token']);
  });

  it('uygulayıcı başkasının randevusunun bildirimini almaz', async () => {
    await register(clinic.practitioner.tokens, 'practitioner-token', 'android').expect(204);
    const devices = await app
      .get(TenantTxService)
      .runForTenant(clinic.tenant.id, (t) =>
        pushRepo.recipients(t, {
          branchId: clinic.branch.id,
          kind: 'appointment_created',
          appointmentId: randomUUID(),
        }),
      );
    expect(devices).toHaveLength(0);
  });

  it('başka kliniğin cihazı alıcı listesine girmez', async () => {
    await register(clinic.owner.tokens, 'owner-token').expect(204);
    const other = await setupClinic(app, { slug: 'diger-klinik' });
    const devices = await app
      .get(TenantTxService)
      .runForTenant(other.tenant.id, (tx) => pushRepo.recipients(tx, { branchId: null, kind: 'appointment_created', appointmentId: null }));
    expect(devices).toHaveLength(0);
  });
});
