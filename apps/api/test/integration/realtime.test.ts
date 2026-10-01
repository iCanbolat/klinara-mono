import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WebSocket } from 'ws';
import { TenantTxService } from '../../src/database/tenant-tx.service';
import { StaffNotificationsService } from '../../src/modules/notifications/staff-notifications.service';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';

/** Soketten gelen mesajları sıraya alır; `next()` bir sonrakini bekler. */
class Probe {
  private readonly queue: unknown[] = [];
  private waiter: ((value: unknown) => void) | undefined;
  readonly closed: Promise<number>;

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data: Buffer) => {
      const message: unknown = JSON.parse(data.toString('utf8'));
      if (this.waiter !== undefined) {
        const resolve = this.waiter;
        this.waiter = undefined;
        resolve(message);
      } else {
        this.queue.push(message);
      }
    });
    this.closed = new Promise((resolve) => socket.on('close', (code) => resolve(code)));
  }

  next(timeoutMs = 5_000): Promise<unknown> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Soketten mesaj gelmedi')), timeoutMs);
      this.waiter = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
    });
  }
}

describe('anlık olay soketi', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;
  const sockets: WebSocket[] = [];

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

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.terminate();
  });

  const open = async (path = '/api/v1/realtime'): Promise<Probe> => {
    const { port } = app.getHttpServer().address() as AddressInfo;
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    sockets.push(socket);
    const probe = new Probe(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return probe;
  };

  const ticket = async (): Promise<string> => {
    const res = await http(app).post('/api/v1/realtime/ticket').set(auth(clinic.owner.tokens));
    expect(res.status).toBe(200);
    return (res.body as { ticket: string }).ticket;
  };

  const connect = async (): Promise<Probe> => {
    const probe = await open();
    probe.socket.send(JSON.stringify({ type: 'auth', ticket: await ticket() }));
    expect(await probe.next()).toEqual({ type: 'ready' });
    return probe;
  };

  const emit = (tenantId: string, rollback = false) =>
    app
      .get(TenantTxService)
      .runForTenant(tenantId, async (tx) => {
        await app.get(StaffNotificationsService).emit(tx, {
          tenantId,
          kind: 'inbound_message',
          title: 'Müşteri yazdı',
        });
        if (rollback) throw new Error('geri al');
      })
      .catch((error: unknown) => {
        if (!rollback) throw error;
      });

  it('bilet kimlik ister', async () => {
    const res = await http(app).post('/api/v1/realtime/ticket');
    expect(res.status).toBe(401);
  });

  it('bilet REST token olarak kullanılamaz', async () => {
    const res = await http(app).get('/api/v1/me').set(auth(await ticket()));
    expect(res.status).toBe(401);
  });

  it('bildirim yazılınca bağlı panele olay düşer; içerik taşımaz', async () => {
    const probe = await connect();
    await emit(clinic.tenant.id);
    expect(await probe.next()).toEqual({ type: 'staff_notification', kind: 'inbound_message' });
  });

  it('geri alınan transaction olay yayınlamaz', async () => {
    const probe = await connect();
    await emit(clinic.tenant.id, true);
    await emit(clinic.tenant.id);
    // İlk gelen olay ikinci (commit olan) yazıma ait; öncesinde başka yok.
    expect(await probe.next()).toEqual({ type: 'staff_notification', kind: 'inbound_message' });
    await expect(probe.next(300)).rejects.toThrow();
  });

  it('başka kliniğin olayı gelmez', async () => {
    const probe = await connect();
    const other = await setupClinic(app, { slug: 'diger-klinik' });
    await emit(other.tenant.id);
    await expect(probe.next(500)).rejects.toThrow();
  });

  it('access token bilet yerine geçmez', async () => {
    const probe = await open();
    probe.socket.send(JSON.stringify({ type: 'auth', ticket: clinic.owner.tokens.accessToken }));
    expect(await probe.closed).toBe(4401);
  });

  it('geçersiz ilk mesaj soketi kapatır', async () => {
    const probe = await open();
    probe.socket.send('merhaba');
    expect(await probe.closed).toBe(4401);
  });

  it('başka yola yükseltme reddedilir', async () => {
    await expect(open('/api/v1/me')).rejects.toThrow();
  });
});
