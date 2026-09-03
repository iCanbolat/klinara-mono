import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, bootstrapTenant, http, PLATFORM_TOKEN, type TenantFixture } from '../helpers/identity';
import { DRIZZLE, type Database } from '../../src/database/database.constants';
import { withPublicTx } from '../../src/database/tenant-tx';
import { emptyContext } from '../../src/common/request-context';

const EDGE_TOKEN = 'kenar-proxy-tokeni-32-karakterden-daha-uzun';
const ROOT_DOMAIN = 'klinara.localhost';

interface DomainBody {
  id: string;
  host: string;
  kind: string;
  verificationStatus: string;
  isPrimary: boolean;
  dnsInstructions: { txtName: string; txtValue: string; cnameName: string; cnameValue: string } | null;
}
interface PageBody {
  id: string;
  slug: string;
  status: string;
  canonicalUrl: string;
  hasUnpublishedChanges: boolean;
  settings: Record<string, unknown>;
}
interface Problem {
  code: string;
}

describe('randevu sayfası: site, alan adı ve public çözümleme (Batch 9.1)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let db: Database;
  let clinic: TenantFixture;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
        EDGE_AUTH_TOKEN: EDGE_TOKEN,
        PUBLIC_BOOKING_DOMAIN: ROOT_DOMAIN,
      },
    });
    db = app.get<Database>(DRIZZLE);
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    clinic = await bootstrapTenant(app, { slug: 'klinik-x', name: 'Klinik X' });
  });

  const ownerAuth = () => auth(clinic.owner.tokens);

  describe('site kaydı', () => {
    it('ilk çağrıda tembel açılır ve platform subdomain’i ile birlikte doğar', async () => {
      const res = await http(app).get('/api/v1/booking-page').set(ownerAuth()).expect(200);
      const body = res.body as PageBody;

      expect(body.slug).toBe('klinik-x');
      expect(body.status).toBe('draft');
      expect(body.canonicalUrl).toBe(`https://klinik-x.${ROOT_DOMAIN}`);

      const domains = await http(app)
        .get('/api/v1/booking-page/domains')
        .set(ownerAuth())
        .expect(200);
      const rows = domains.body as DomainBody[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'platform_subdomain',
        verificationStatus: 'active',
        isPrimary: true,
      });
      // Platform adresinin DNS talimatı YOKTUR — bize ait, klinik bir şey yapmaz.
      expect(rows[0]?.dnsInstructions).toBeNull();
    });

    it('kiracı slug’ı değişince site ve subdomain ONUNLA taşınır', async () => {
      await http(app).get('/api/v1/booking-page').set(ownerAuth()).expect(200);

      await http(app)
        .patch('/api/v1/tenant')
        .set(ownerAuth())
        .send({ name: 'Klinik X' })
        .expect((res) => {
          // İsim güncellemesi slug’a dokunmaz; slug değişimini doğrudan yazıyoruz.
          expect([200, 404]).toContain(res.status);
        });

      await database.ownerPool.query(`update tenants set slug = 'klinik-y' where id = $1`, [
        clinic.tenant.id,
      ]);

      const res = await http(app).get('/api/v1/booking-page').set(ownerAuth()).expect(200);
      expect((res.body as PageBody).slug).toBe('klinik-y');
      expect((res.body as PageBody).canonicalUrl).toBe(`https://klinik-y.${ROOT_DOMAIN}`);
    });

    it('resepsiyon sayfayı OKUR ama yönetemez', async () => {
      const { inviteMember } = await import('../helpers/identity');
      const desk = await inviteMember(app, clinic.owner.tokens, {
        email: 'resepsiyon@klinik-x.test',
        roleKey: 'receptionist',
        branchId: clinic.branch.id,
      });

      await http(app).get('/api/v1/booking-page').set(auth(desk.tokens)).expect(200);
      await http(app)
        .post('/api/v1/booking-page/publish')
        .set(auth(desk.tokens))
        .expect(403);
    });
  });

  describe('özel alan adı', () => {
    const addDomain = (host: string) =>
      http(app).post('/api/v1/booking-page/domains').set(ownerAuth()).send({ host });

    it('eklenir ve kopyalanabilir DNS talimatı döner', async () => {
      const res = await addDomain('Randevu.KlinikX.com.').expect(201);
      const body = res.body as DomainBody;

      // Normalizasyon SUNUCUDA: küçük harf ve sondaki nokta kırpılmış.
      expect(body.host).toBe('randevu.klinikx.com');
      expect(body.verificationStatus).toBe('pending');
      expect(body.isPrimary).toBe(false);
      expect(body.dnsInstructions).toMatchObject({
        txtName: '_klinara-verify.randevu.klinikx.com',
        cnameName: 'randevu.klinikx.com',
        cnameValue: `klinik-x.${ROOT_DOMAIN}`,
      });
      expect(body.dnsInstructions?.txtValue).toMatch(/^klinara-verify-[0-9a-f]{32}$/);
    });

    it('IDN alan adı punycode’a normalize edilir', async () => {
      const res = await addDomain('randevu.kliniğim.com').expect(201);
      expect((res.body as DomainBody).host).toBe('randevu.xn--kliniim-rbb.com');
    });

    it('platformun kök alan adı altında özel alan adı REDDEDİLİR', async () => {
      const res = await addDomain(`sahte.${ROOT_DOMAIN}`).expect(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('rezerve konak adı reddedilir', async () => {
      await addDomain('www.example.com').expect(201); // `www.example.com` rezerve DEĞİL
      const res = await addDomain('www').expect(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('şema veya yol içeren girdi reddedilir', async () => {
      await addDomain('https://randevu.klinikx.com').expect(400);
      await addDomain('randevu.klinikx.com/path').expect(400);
      await addDomain('evil.com@klinikx.com').expect(400);
    });

    it('başka kiracıda kayıtlı konak adı HOST_TAKEN döner ve sahibini SÖYLEMEZ', async () => {
      await addDomain('randevu.klinikx.com').expect(201);

      const other = await bootstrapTenant(app, { slug: 'klinik-z', name: 'Klinik Z' });
      const res = await http(app)
        .post('/api/v1/booking-page/domains')
        .set(auth(other.owner.tokens))
        .send({ host: 'randevu.klinikx.com' })
        .expect(409);

      expect((res.body as Problem).code).toBe('HOST_TAKEN');
      expect(JSON.stringify(res.body)).not.toContain('klinik-x');
      expect(JSON.stringify(res.body)).not.toContain(clinic.tenant.id);
    });

    it('platform subdomain’i KALDIRILAMAZ', async () => {
      const domains = await http(app)
        .get('/api/v1/booking-page/domains')
        .set(ownerAuth())
        .expect(200);
      const platform = (domains.body as DomainBody[])[0]!;

      await http(app)
        .delete(`/api/v1/booking-page/domains/${platform.id}`)
        .set(ownerAuth())
        .expect(403);
    });

    it('doğrulanmamış alan adı kanonik adres YAPILAMAZ', async () => {
      const created = await addDomain('randevu.klinikx.com').expect(201);
      const res = await http(app)
        .post(`/api/v1/booking-page/domains/${(created.body as DomainBody).id}/primary`)
        .set(ownerAuth())
        .expect(409);
      expect((res.body as Problem).code).toBe('DOMAIN_VERIFICATION_FAILED');
    });
  });

  describe('public çözümleme', () => {
    async function publish(): Promise<void> {
      await http(app).get('/api/v1/booking-page').set(ownerAuth()).expect(200);
      await http(app)
        .put('/api/v1/booking-page/content')
        .set(ownerAuth())
        .set('If-Match', 'W/"0"')
        .send({ sections: [{ type: 'hero', title: 'Klinik X' }] })
        .expect(200);
      await http(app).post('/api/v1/booking-page/publish').set(ownerAuth()).expect(200);
    }

    it('yayınlanmamış site için 404 döner', async () => {
      await http(app).get('/api/v1/booking-page').set(ownerAuth()).expect(200);
      await http(app)
        .get(`/api/v1/public/resolve?host=klinik-x.${ROOT_DOMAIN}`)
        .expect(404);
    });

    it('yayınlandıktan sonra slug ve kanonik adres döner', async () => {
      await publish();
      const res = await http(app)
        .get(`/api/v1/public/resolve?host=KLINIK-X.${ROOT_DOMAIN}:443`)
        .expect(200);
      expect(res.body).toEqual({
        slug: 'klinik-x',
        canonicalUrl: `https://klinik-x.${ROOT_DOMAIN}`,
      });
    });

    it('bilinmeyen konak adı 404 ve negatif yanıt CACHE’LENMEZ', async () => {
      await publish();
      const res = await http(app).get('/api/v1/public/resolve?host=yok.example.com').expect(404);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('geçersiz konak adı da 404 — "kayıtlı değil" ile aynı yanıt', async () => {
      await publish();
      await http(app).get('/api/v1/public/resolve?host=not a host').expect(404);
      await http(app).get('/api/v1/public/resolve').expect(404);
    });
  });

  describe('kenar proxy iç ucu', () => {
    it('token olmadan 401', async () => {
      await http(app)
        .get(`/api/v1/internal/booking-domains/authorize?host=klinik-x.${ROOT_DOMAIN}`)
        .expect(401);
    });

    it('platform admin token’ı ile de geçilemez', async () => {
      await http(app)
        .get(`/api/v1/internal/booking-domains/authorize?host=klinik-x.${ROOT_DOMAIN}`)
        .set('x-klinara-edge-token', PLATFORM_TOKEN)
        .expect(401);
    });

    it('aktif konak adı için 200 döner', async () => {
      await http(app).get('/api/v1/booking-page').set(ownerAuth()).expect(200);
      const res = await http(app)
        .get(`/api/v1/internal/booking-domains/authorize?host=klinik-x.${ROOT_DOMAIN}`)
        .set('x-klinara-edge-token', EDGE_TOKEN)
        .expect(200);
      expect(res.body).toEqual({ authorized: true });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('bilinmeyen konak adında 2xx DÖNMEZ — Caddy 2xx’i "sertifika al" olarak okur', async () => {
      const res = await http(app)
        .get('/api/v1/internal/booking-domains/authorize?host=saldirgan.example.com')
        .set('x-klinara-edge-token', EDGE_TOKEN)
        .expect(403);
      expect(JSON.stringify(res.body)).not.toContain('klinik-x');
    });

    it('dns_verified bir alan adı ilk sorguda active’e terfi eder', async () => {
      const created = await http(app)
        .post('/api/v1/booking-page/domains')
        .set(ownerAuth())
        .send({ host: 'randevu.klinikx.com' })
        .expect(201);
      const domainId = (created.body as DomainBody).id;

      await database.ownerPool.query(
        `update booking_site_domains set verification_status = 'dns_verified' where id = $1`,
        [domainId],
      );

      await http(app)
        .get('/api/v1/internal/booking-domains/authorize?host=randevu.klinikx.com')
        .set('x-klinara-edge-token', EDGE_TOKEN)
        .expect(200);

      const { rows } = await database.ownerPool.query<{ status: string; activated_at: Date | null }>(
        `select verification_status as status, activated_at from booking_site_domains where id = $1`,
        [domainId],
      );
      expect(rows[0]?.status).toBe('active');
      expect(rows[0]?.activated_at).not.toBeNull();
    });
  });

  describe('app.public_flow bayrağının etki alanı', () => {
    it('KRİTİK: bayrak altında kiracı verisi okunamaz', async () => {
      await http(app).get('/api/v1/booking-page').set(ownerAuth()).expect(200);
      await http(app)
        .put('/api/v1/booking-page/content')
        .set(ownerAuth())
        .set('If-Match', 'W/"0"')
        .send({ sections: [] })
        .expect(200);
      await http(app).post('/api/v1/booking-page/publish').set(ownerAuth()).expect(200);

      const counts = await withPublicTx(db, emptyContext(), async (tx) => {
        const read = async (table: string): Promise<number> => {
          const result = await tx.execute<{ n: number }>(
            sql.raw(`select count(*)::int as n from ${table}`),
          );
          return result.rows[0]?.n ?? 0;
        };
        return {
          bookingSites: await read('booking_sites'),
          bookingSiteDomains: await read('booking_site_domains'),
          tenants: await read('tenants'),
          users: await read('users'),
          customers: await read('customers'),
          branches: await read('branches'),
          appointments: await read('appointments'),
          revisions: await read('booking_page_revisions'),
          settings: await read('booking_site_settings'),
          slotHolds: await read('slot_holds'),
        };
      });

      // Bayrak yalnız İKİ dizin tablosunu açar.
      expect(counts.bookingSites).toBe(1);
      expect(counts.bookingSiteDomains).toBe(1);

      // Geri kalan HER ŞEY kapalı — içerik ve ayar tabloları dahil.
      expect(counts.tenants).toBe(0);
      expect(counts.users).toBe(0);
      expect(counts.customers).toBe(0);
      expect(counts.branches).toBe(0);
      expect(counts.appointments).toBe(0);
      expect(counts.revisions).toBe(0);
      expect(counts.settings).toBe(0);
      expect(counts.slotHolds).toBe(0);
    });

    it('KRİTİK: current_public_flow() yalnız iki tablonun politikasında geçer', async () => {
      const { rows } = await database.ownerPool.query<{ tablename: string }>(
        `select distinct tablename
           from pg_policies
          where schemaname = 'public'
            and (coalesce(qual, '') like '%current_public_flow%'
                 or coalesce(with_check, '') like '%current_public_flow%')
          order by tablename`,
      );
      expect(rows.map((row) => row.tablename)).toEqual([
        'booking_site_domains',
        'booking_sites',
      ]);
    });

    it('KRİTİK: runAsPublicLookup tek bir servisten çağrılır', async () => {
      const root = path.join(__dirname, '../../src');
      const callers: string[] = [];

      const walk = async (dir: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else if (entry.name.endsWith('.ts')) {
            const source = await readFile(full, 'utf8');
            // Tanımın kendisi (`tenant-tx.service.ts`) çağıran sayılmaz.
            if (source.includes('.runAsPublicLookup(')) callers.push(path.relative(root, full));
          }
        }
      };
      await walk(root);

      expect(callers).toEqual(['modules/public/public-site-resolver.service.ts']);
    });
  });
});
