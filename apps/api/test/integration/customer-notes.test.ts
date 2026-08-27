import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN, type Tokens } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';

interface Problem {
  code: string;
  status: number;
}

interface NoteBody {
  id: string;
  kind: string;
  body: string;
  version: number;
  appointmentId: string | null;
  customerVisible: boolean;
}

interface TimelineEntry {
  kind: string;
  id: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

interface TimelinePage {
  data: TimelineEntry[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

const MONDAY = '2026-09-07';
const at = (hhmm: string) => `${MONDAY}T${hhmm}:00+03:00`;

describe('müşteri notları ve zaman çizelgesi (Batch 4.2)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;
  let receptionist: { userId: string; tokens: Tokens };

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
    receptionist = await inviteMember(app, clinic.owner.tokens, {
      email: 'resepsiyon@demo-klinik.test',
      roleKey: 'receptionist',
      branchId: clinic.branch.id,
    });
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const deskAuth = () => auth(receptionist.tokens);
  const customer = () => clinic.customer.id;

  const addNote = (body: Record<string, unknown>, as = ownerAuth()) =>
    http(app).post(`/api/v1/customers/${customer()}/notes`).set(as).send(body);

  const listNotes = (as = ownerAuth()) =>
    http(app).get(`/api/v1/customers/${customer()}/notes`).set(as);

  // -------------------------------------------------------------------------
  describe('görünürlük', () => {
    it('resepsiyon KLİNİK notlarını ne listede ne detayda görür', async () => {
      const general = await addNote({ body: 'Kapıda karşılandı.' }).expect(201);
      const internal = await addNote({ body: 'Tahsilatı geciktirdi.', kind: 'internal' }).expect(
        201,
      );
      await addNote({ body: 'Cilt reaksiyonu yok.', kind: 'treatment' }).expect(201);

      const asOwner = await listNotes().expect(200);
      expect((asOwner.body as { data: NoteBody[] }).data).toHaveLength(3);

      const asDesk = await listNotes(deskAuth()).expect(200);
      const visible = (asDesk.body as { data: NoteBody[] }).data;
      expect(visible.map((n) => n.id)).toEqual([(general.body as NoteBody).id]);

      // Detayda 403 değil 404: 403 "bu kayıt var ama sana kapalı" bilgisini
      // sızdırırdı.
      const revisions = await http(app)
        .get(`/api/v1/notes/${(internal.body as NoteBody).id}/revisions`)
        .set(deskAuth());
      expect(revisions.status).toBe(404);
    });

    it('resepsiyon klinik notu YAZAMAZ', async () => {
      const res = await addNote({ body: 'Klinik gözlem', kind: 'treatment' }, deskAuth());
      expect(res.status).toBe(403);
      expect((res.body as Problem).code).toBe('FORBIDDEN');

      // Serbest not yazabilir.
      await addNote({ body: 'Telefonla arandı.' }, deskAuth()).expect(201);
    });

    it('resepsiyon göremediği notu düzenleyemez', async () => {
      const internal = await addNote({ body: 'İç not', kind: 'internal' }).expect(201);

      const res = await http(app)
        .patch(`/api/v1/notes/${(internal.body as NoteBody).id}`)
        .set(deskAuth())
        .send({ body: 'Değiştirildi' });
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('düzenleme geçmişi', () => {
    it('metin değişince eski sürüm saklanır ve version artar', async () => {
      const created = await addNote({ body: 'İlk hâli' }).expect(201);
      const id = (created.body as NoteBody).id;
      expect((created.body as NoteBody).version).toBe(1);

      const updated = await http(app)
        .patch(`/api/v1/notes/${id}`)
        .set(ownerAuth())
        .send({ body: 'İkinci hâli' })
        .expect(200);
      expect((updated.body as NoteBody).version).toBe(2);

      const revisions = await http(app)
        .get(`/api/v1/notes/${id}/revisions`)
        .set(ownerAuth())
        .expect(200);
      const rows = (revisions.body as { data: { body: string; version: number }[] }).data;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.body).toBe('İlk hâli');
      expect(rows[0]?.version).toBe(1);
    });

    it('metin DIŞINDA bir alan değişince revizyon yazılmaz', async () => {
      const created = await addNote({ body: 'Sabit metin' }).expect(201);
      const id = (created.body as NoteBody).id;

      const updated = await http(app)
        .patch(`/api/v1/notes/${id}`)
        .set(ownerAuth())
        .send({ customerVisible: true })
        .expect(200);
      expect((updated.body as NoteBody).version).toBe(1);
      expect((updated.body as NoteBody).customerVisible).toBe(true);

      const revisions = await http(app)
        .get(`/api/v1/notes/${id}/revisions`)
        .set(ownerAuth())
        .expect(200);
      expect((revisions.body as { data: unknown[] }).data).toHaveLength(0);
    });

    it('arşivlenen not listeden çıkar', async () => {
      const created = await addNote({ body: 'Silinecek' }).expect(201);
      await http(app)
        .delete(`/api/v1/notes/${(created.body as NoteBody).id}`)
        .set(ownerAuth())
        .expect(204);

      const list = await listNotes().expect(200);
      expect((list.body as { data: NoteBody[] }).data).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('zaman çizelgesi', () => {
    const createAppointment = (hhmm: string) =>
      http(app)
        .post('/api/v1/appointments')
        .set(ownerAuth())
        .set(branchHeader(clinic.branch.id))
        .send({
          branchId: clinic.branch.id,
          customerId: customer(),
          startsAt: at(hhmm),
          services: [
            {
              serviceId: clinic.quickService.id,
              staffProfileId: clinic.practitioner.staffProfileId,
            },
          ],
        });

    it('randevu ve notları tek akışta, yeniden eskiye sıralar', async () => {
      await createAppointment('10:00').expect(201);
      await createAppointment('14:00').expect(201);
      await addNote({ body: 'Not 1' }).expect(201);
      await addNote({ body: 'Not 2' }).expect(201);

      const res = await http(app)
        .get(`/api/v1/customers/${customer()}/timeline`)
        .set(ownerAuth())
        .expect(200);
      const page = res.body as TimelinePage;

      expect(page.data).toHaveLength(4);
      expect(page.data.filter((e) => e.kind === 'appointment')).toHaveLength(2);
      expect(page.data.filter((e) => e.kind === 'note')).toHaveLength(2);

      const times = page.data.map((e) => new Date(e.occurredAt).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it('cursor sayfaları örtüşmez ve kol sınırını doğru geçer', async () => {
      await createAppointment('10:00').expect(201);
      await createAppointment('14:00').expect(201);
      await addNote({ body: 'Not 1' }).expect(201);
      await addNote({ body: 'Not 2' }).expect(201);

      const seen = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;

      do {
        const query: Record<string, string | number> = { limit: 2 };
        if (cursor !== null) query.cursor = cursor;
        const res = await http(app)
          .get(`/api/v1/customers/${customer()}/timeline`)
          .query(query)
          .set(ownerAuth())
          .expect(200);
        const page = res.body as TimelinePage;
        for (const entry of page.data) {
          expect(seen.has(entry.id)).toBe(false);
          seen.add(entry.id);
        }
        cursor = page.pageInfo.nextCursor;
        pages += 1;
      } while (cursor !== null && pages < 10);

      expect(seen.size).toBe(4);
    });

    it('resepsiyonun zaman çizelgesinde klinik notu görünmez', async () => {
      await createAppointment('10:00').expect(201);
      await addNote({ body: 'İç not', kind: 'internal' }).expect(201);

      const res = await http(app)
        .get(`/api/v1/customers/${customer()}/timeline`)
        .set(deskAuth())
        .expect(200);
      const page = res.body as TimelinePage;
      expect(page.data.map((e) => e.kind)).toEqual(['appointment']);
    });

    it('BAŞKA kiracının müşterisinin çizelgesi 404', async () => {
      const other = await setupClinic(app, { slug: 'klinik-b' });
      const res = await http(app)
        .get(`/api/v1/customers/${other.customer.id}/timeline`)
        .set(ownerAuth());
      expect(res.status).toBe(404);
    });
  });
});
