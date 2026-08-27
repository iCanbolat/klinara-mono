import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN } from '../helpers/identity';
import {
  branchHeader,
  setupClinic,
  weeklyStaffSchedule,
  type ClinicFixture,
} from '../helpers/clinic';

interface Problem {
  code: string;
  status: number;
  errors?: { path: string; message: string }[];
}

interface TagBody {
  id: string;
  name: string;
  color: string | null;
}

interface CustomerBody {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  city: string | null;
  source: string | null;
  mergedIntoCustomerId: string | null;
  tags: TagBody[];
}

interface CustomerPage {
  data: CustomerBody[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

interface MergeBody {
  id: string;
  sourceCustomerId: string;
  targetCustomerId: string;
  moved: Record<string, number>;
  customer: CustomerBody;
}

const MONDAY = '2026-09-07';
const at = (hhmm: string) => `${MONDAY}T${hhmm}:00+03:00`;

describe('müşteri kartı (Batch 4.1)', () => {
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

  const addCustomer = async (body: Record<string, unknown>): Promise<CustomerBody> => {
    const res = await http(app).post('/api/v1/customers').set(ownerAuth()).send(body);
    expect(res.status).toBe(201);
    return res.body as CustomerBody;
  };

  const search = (q: string) =>
    http(app).get('/api/v1/customers/search').query({ q }).set(ownerAuth());

  // -------------------------------------------------------------------------
  describe('arama', () => {
    it('Türkçe büyük/küçük harf farkını yok sayar', async () => {
      await addCustomer({ fullName: 'Işıl Şahinoğlu' });

      // `I`→`ı` ve `İ`→`i` eşlemesi: `lowercased()` ile bu isim bulunamazdı.
      for (const q of ['ŞAHİNOĞLU', 'şahinoğlu', 'Sahinoglu', 'IŞIL', 'ışıl', 'isil']) {
        const res = await search(q);
        expect(res.status).toBe(200);
        expect((res.body as CustomerBody[]).map((c) => c.fullName)).toEqual(['Işıl Şahinoğlu']);
      }
    });

    it('Türkçe klavyesi olmadan yazılan arama da bulur', async () => {
      // `ı` aksanlı bir `i` DEĞİL, ayrı bir harf; `unaccent` bunu çözmezdi.
      await addCustomer({ fullName: 'Çağrı Öğüt' });

      for (const q of ['cagri', 'ogut', 'ÇAĞRI']) {
        const res = await search(q);
        expect((res.body as CustomerBody[]).map((c) => c.fullName)).toEqual(['Çağrı Öğüt']);
      }
    });

    it('yerel biçimde yazılan telefon E.164 kaydı bulur', async () => {
      await addCustomer({ fullName: 'Mehmet Demir', phone: '+905339998877' });

      for (const q of ['0533 999 88 77', '+905339998877', '9998877']) {
        const res = await search(q);
        expect((res.body as CustomerBody[]).map((c) => c.fullName)).toEqual(['Mehmet Demir']);
      }
    });

    it('iki karakterden kısa sorgu reddedilir', async () => {
      const res = await search('a');
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('arşivlenmiş müşteri arama sonucunda çıkmaz', async () => {
      const customer = await addCustomer({ fullName: 'Silinen Kayıt' });
      await http(app).delete(`/api/v1/customers/${customer.id}`).set(ownerAuth()).expect(200);

      const res = await search('silinen');
      expect(res.body as CustomerBody[]).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('sayfalama', () => {
    it('cursor ile ilerler ve sayfalar örtüşmez', async () => {
      for (let i = 0; i < 5; i += 1) {
        await addCustomer({ fullName: `Müşteri ${i}` });
      }

      const first = await http(app)
        .get('/api/v1/customers')
        .query({ limit: 2 })
        .set(ownerAuth())
        .expect(200);
      const firstPage = first.body as CustomerPage;
      expect(firstPage.data).toHaveLength(2);
      expect(firstPage.pageInfo.hasMore).toBe(true);

      const seen = new Set(firstPage.data.map((c) => c.id));
      let cursor = firstPage.pageInfo.nextCursor;

      while (cursor !== null) {
        const next = await http(app)
          .get('/api/v1/customers')
          .query({ limit: 2, cursor })
          .set(ownerAuth())
          .expect(200);
        const page = next.body as CustomerPage;
        for (const row of page.data) {
          expect(seen.has(row.id)).toBe(false);
          seen.add(row.id);
        }
        cursor = page.pageInfo.nextCursor;
      }

      // 5 yeni + fixture'ın açtığı müşteri.
      expect(seen.size).toBe(6);
    });

    it('bozuk cursor 400 verir', async () => {
      const res = await http(app)
        .get('/api/v1/customers')
        .query({ limit: 2, cursor: 'bozuk-cursor' })
        .set(ownerAuth());
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  describe('etiketler', () => {
    const createTag = async (name: string, color?: string): Promise<TagBody> => {
      const res = await http(app)
        .post('/api/v1/customer-tags')
        .set(ownerAuth())
        .send(color === undefined ? { name } : { name, color });
      expect(res.status).toBe(201);
      return res.body as TagBody;
    };

    it('etiketi oluşturur, müşteriye atar ve listede döndürür', async () => {
      const tag = await createTag('VIP', '#c0392b');
      const customer = await addCustomer({ fullName: 'Etiketli Müşteri' });

      const assigned = await http(app)
        .put(`/api/v1/customers/${customer.id}/tags`)
        .set(ownerAuth())
        .send({ tagIds: [tag.id] })
        .expect(200);
      expect((assigned.body as CustomerBody).tags).toEqual([
        { id: tag.id, name: 'VIP', color: '#c0392b' },
      ]);

      const filtered = await http(app)
        .get('/api/v1/customers')
        .query({ tagId: tag.id })
        .set(ownerAuth())
        .expect(200);
      expect((filtered.body as CustomerPage).data.map((c) => c.id)).toEqual([customer.id]);
    });

    it('katlanmış adı aynı olan ikinci etiket reddedilir', async () => {
      await createTag('VIP');
      for (const name of ['vip', 'Vip', 'vıp']) {
        const res = await http(app).post('/api/v1/customer-tags').set(ownerAuth()).send({ name });
        expect(res.status).toBe(409);
        expect((res.body as Problem).code).toBe('CONFLICT');
      }
    });

    it('geçersiz renk biçimi alan bazlı hata verir', async () => {
      const res = await http(app)
        .post('/api/v1/customer-tags')
        .set(ownerAuth())
        .send({ name: 'Renkli', color: 'kırmızı' });
      expect(res.status).toBe(400);
      expect((res.body as Problem).errors?.[0]?.path).toBe('color');
    });

    it('PUT tags mevcut atamaları DEĞİŞTİRİR, eklemez', async () => {
      const first = await createTag('İlk');
      const second = await createTag('İkinci');
      const customer = await addCustomer({ fullName: 'Değişen Etiket' });

      await http(app)
        .put(`/api/v1/customers/${customer.id}/tags`)
        .set(ownerAuth())
        .send({ tagIds: [first.id] })
        .expect(200);

      const replaced = await http(app)
        .put(`/api/v1/customers/${customer.id}/tags`)
        .set(ownerAuth())
        .send({ tagIds: [second.id] })
        .expect(200);
      expect((replaced.body as CustomerBody).tags.map((t) => t.name)).toEqual(['İkinci']);
    });

    it('BAŞKA kiracının etiketi atanamaz', async () => {
      const other = await setupClinic(app, { slug: 'klinik-b' });
      const foreignTag = await http(app)
        .post('/api/v1/customer-tags')
        .set(auth(other.owner.tokens))
        .send({ name: 'Yabancı' })
        .expect(201);
      const customer = await addCustomer({ fullName: 'Bizim Müşteri' });

      // FK doğrulaması RLS'i bypass eder — kimlik geçerli görünür, kuralı
      // kapsam trigger'ı tutar (Faz 3'ün dersi).
      const res = await http(app)
        .put(`/api/v1/customers/${customer.id}/tags`)
        .set(ownerAuth())
        .send({ tagIds: [(foreignTag.body as TagBody).id] });
      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CONFLICT');
    });

    it('etiket silinince müşteriden de düşer', async () => {
      const tag = await createTag('Geçici');
      const customer = await addCustomer({ fullName: 'Etiketi Silinen' });
      await http(app)
        .put(`/api/v1/customers/${customer.id}/tags`)
        .set(ownerAuth())
        .send({ tagIds: [tag.id] })
        .expect(200);

      await http(app).delete(`/api/v1/customer-tags/${tag.id}`).set(ownerAuth()).expect(204);

      const res = await http(app)
        .get(`/api/v1/customers/${customer.id}`)
        .set(ownerAuth())
        .expect(200);
      expect((res.body as CustomerBody).tags).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('birleştirme', () => {
    const merge = (targetId: string, sourceCustomerId: string) =>
      http(app)
        .post(`/api/v1/customers/${targetId}/merge`)
        .set(ownerAuth())
        .send({ sourceCustomerId });

    const createAppointment = (customerId: string, hhmm: string) =>
      http(app)
        .post('/api/v1/appointments')
        .set(ownerAuth())
        .set(branch())
        .send({
          branchId: clinic.branch.id,
          customerId,
          startsAt: at(hhmm),
          services: [
            {
              serviceId: clinic.quickService.id,
              staffProfileId: clinic.practitioner.staffProfileId,
            },
          ],
        });

    it('randevuları taşır, kaynağı arşivler ve iz bırakır', async () => {
      const target = await addCustomer({ fullName: 'Ayşe Yılmaz', city: 'İstanbul' });
      const source = await addCustomer({ fullName: 'Ayse Yilmaz', email: 'ayse@ornek.com' });

      await createAppointment(source.id, '10:00').expect(201);
      await createAppointment(target.id, '11:00').expect(201);

      const res = await merge(target.id, source.id);
      expect(res.status).toBe(200);
      const body = res.body as MergeBody;
      expect(body.moved.appointments).toBe(1);
      expect(body.moved.customer_bookings).toBe(1);
      // Hedefin boş alanı kaynaktan doldu, DOLU alanı ezilmedi.
      expect(body.customer.email).toBe('ayse@ornek.com');
      expect(body.customer.city).toBe('İstanbul');

      // Kaynak arşivlendi ve hayatta kalana işaret ediyor.
      const archived = await http(app)
        .get(`/api/v1/customers/${source.id}`)
        .set(ownerAuth());
      expect(archived.status).toBe(404);

      // Hiçbir randevu yetim kalmadı: ikisi de hedefte.
      const list = await http(app)
        .get('/api/v1/appointments')
        .query({ from: `${MONDAY}T00:00:00+03:00`, to: `${MONDAY}T23:59:00+03:00` })
        .set(ownerAuth())
        .set(branch())
        .expect(200);
      const entries = (list.body as { data: { customerId: string }[] }).data;
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.customerId === target.id)).toBe(true);
    });

    it('etiketler birleşir, çakışan atama kopyalanmaz', async () => {
      const shared = await http(app)
        .post('/api/v1/customer-tags')
        .set(ownerAuth())
        .send({ name: 'Ortak' })
        .expect(201);
      const only = await http(app)
        .post('/api/v1/customer-tags')
        .set(ownerAuth())
        .send({ name: 'Yalnız Kaynakta' })
        .expect(201);

      const target = await addCustomer({ fullName: 'Hedef' });
      const source = await addCustomer({ fullName: 'Kaynak' });
      const sharedId = (shared.body as TagBody).id;
      const onlyId = (only.body as TagBody).id;

      await http(app)
        .put(`/api/v1/customers/${target.id}/tags`)
        .set(ownerAuth())
        .send({ tagIds: [sharedId] })
        .expect(200);
      await http(app)
        .put(`/api/v1/customers/${source.id}/tags`)
        .set(ownerAuth())
        .send({ tagIds: [sharedId, onlyId] })
        .expect(200);

      const res = await merge(target.id, source.id).expect(200);
      const names = (res.body as MergeBody).customer.tags.map((t) => t.name).sort();
      expect(names).toEqual(['Ortak', 'Yalnız Kaynakta']);
      expect((res.body as MergeBody).moved.customer_tag_assignments).toBe(1);
    });

    it('notlar ezilmez, birleştirilir', async () => {
      const target = await addCustomer({ fullName: 'Hedef', notes: 'Hedefin notu' });
      const source = await addCustomer({ fullName: 'Kaynak', notes: 'Kaynağın notu' });

      const res = await merge(target.id, source.id).expect(200);
      const notes = (res.body as MergeBody).customer.notes ?? '';
      expect(notes).toContain('Hedefin notu');
      expect(notes).toContain('Kaynağın notu');
    });

    it('ÇAKIŞAN randevuları olan iki kart birleştirilemez', async () => {
      // `customer_bookings` üzerindeki EXCLUDE constraint'i devrede: aynı
      // müşteri aynı anda iki randevuda olamaz. Sessizce yutmak, iki randevudan
      // birinin kaybolması demek olurdu.
      const target = await addCustomer({ fullName: 'Hedef' });
      const source = await addCustomer({ fullName: 'Kaynak' });

      // Aynı saate ikinci bir randevu ancak İKİNCİ bir personelle açılabilir.
      const second = await inviteMember(app, clinic.owner.tokens, {
        email: 'ikinci@klinik.com',
        roleKey: 'practitioner',
        branchId: clinic.branch.id,
        fullName: 'İkinci Uygulayıcı',
      });
      const staff = await http(app)
        .post('/api/v1/staff')
        .set(ownerAuth())
        .send({
          userId: second.userId,
          primaryBranchId: clinic.branch.id,
          title: 'İkinci Uzman',
          services: [{ serviceId: clinic.quickService.id, branchId: clinic.branch.id }],
        })
        .expect(201);
      const secondStaffId = (staff.body as { id: string }).id;

      await http(app)
        .put(`/api/v1/staff/${secondStaffId}/schedule`)
        .set(ownerAuth())
        .set(branch())
        .send({ branchId: clinic.branch.id, entries: weeklyStaffSchedule() })
        .expect(200);

      await createAppointment(target.id, '10:00').expect(201);
      await http(app)
        .post('/api/v1/appointments')
        .set(ownerAuth())
        .set(branch())
        .send({
          branchId: clinic.branch.id,
          customerId: source.id,
          startsAt: at('10:00'),
          services: [{ serviceId: clinic.quickService.id, staffProfileId: secondStaffId }],
        })
        .expect(201);

      const res = await merge(target.id, source.id);
      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CONFLICT');
    });

    it('kayıt kendisiyle birleştirilemez', async () => {
      const customer = await addCustomer({ fullName: 'Tek Kayıt' });
      const res = await merge(customer.id, customer.id);
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('BAŞKA kiracının müşterisi birleştirilemez', async () => {
      const other = await setupClinic(app, { slug: 'klinik-b' });
      const target = await addCustomer({ fullName: 'Hedef' });

      const res = await merge(target.id, other.customer.id);
      // RLS yüzünden kaynak kayıt hiç görünmüyor: varlığı bile sızmıyor.
      expect(res.status).toBe(404);
    });

    it('resepsiyon birleştiremez — customer:merge izni yok', async () => {
      const receptionist = await inviteMember(app, clinic.owner.tokens, {
        email: 'resepsiyon@klinik.com',
        roleKey: 'receptionist',
        branchId: clinic.branch.id,
      });
      const target = await addCustomer({ fullName: 'Hedef' });
      const source = await addCustomer({ fullName: 'Kaynak' });

      const res = await http(app)
        .post(`/api/v1/customers/${target.id}/merge`)
        .set(auth(receptionist.tokens))
        .set(branch())
        .send({ sourceCustomerId: source.id });
      expect(res.status).toBe(403);
      expect((res.body as Problem).code).toBe('FORBIDDEN');
    });
  });
});
