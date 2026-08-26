import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import {
  auth,
  bootstrapTenant,
  http,
  inviteMember,
  login,
  PLATFORM_TOKEN,
  type TenantFixture,
} from '../helpers/identity';
import { SMS_SENDER, type SmsMessage, type SmsSender } from '../../src/lib/sms/sms.types';

interface Problem {
  code: string;
  status: number;
}

/** Yerel gönderici: SMS dışarı çıkmaz, içerik burada birikir. */
interface CapturingSender extends SmsSender {
  sent: SmsMessage[];
}

describe('telefon doğrulama — SMS (Batch 1.5)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let sms: CapturingSender;
  let fixture: TenantFixture;

  const lastCode = (): string => {
    const message = sms.sent.at(-1);
    if (message === undefined) throw new Error('SMS gönderilmedi');
    const match = /(\d{6})/.exec(message.body);
    if (match?.[1] === undefined) throw new Error(`Kod bulunamadı: ${message.body}`);
    return match[1];
  };

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: { DATABASE_URL: database.appUrl, PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN },
    });
    sms = app.get<CapturingSender>(SMS_SENDER);
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    sms.sent.length = 0;
    fixture = await bootstrapTenant(app, { slug: 'telefon-klinigi', name: 'Telefon Kliniği' });
  });

  // -------------------------------------------------------------------------
  describe('numara ekleme', () => {
    it('kod SMS ile gider ve numara HENÜZ profile yazılmaz', async () => {
      const res = await http(app)
        .post('/api/v1/auth/phone/start')
        .set(auth(fixture.owner.tokens))
        .send({ phone: '0532 123 45 67' });

      expect(res.status).toBe(200);
      const body = res.body as { phone: string; delivered: boolean };
      // Ham metin E.164'e normalize edilir.
      expect(body.phone).toBe('+905321234567');
      expect(body.delivered).toBe(true);
      expect(sms.sent).toHaveLength(1);
      expect(sms.sent[0]?.to).toBe('+905321234567');

      // Doğrulanmadan profile yazılmaz: aksi hâlde başkasının numarası
      // "rezerve" edilebilirdi.
      const me = await http(app).get('/api/v1/me').set(auth(fixture.owner.tokens));
      expect((me.body as { user: { phone: string | null } }).user.phone).toBeNull();
    });

    it('kod veritabanında HASH’li durur', async () => {
      await http(app)
        .post('/api/v1/auth/phone/start')
        .set(auth(fixture.owner.tokens))
        .send({ phone: '0532 123 45 67' });

      const code = lastCode();
      const { rows } = await database.ownerPool.query<{ code_hash: string }>(
        'select code_hash from phone_verification_codes',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.code_hash).not.toBe(code);
      expect(rows[0]?.code_hash).toBe(createHash('sha256').update(code).digest('hex'));
    });

    it('geçersiz numara reddedilir', async () => {
      const res = await http(app)
        .post('/api/v1/auth/phone/start')
        .set(auth(fixture.owner.tokens))
        .send({ phone: '123' });
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('sağlayıcı hatası isteği DÜŞÜRMEZ', async () => {
      const original = sms.send.bind(sms);
      sms.send = () => Promise.reject(new Error('Netgsm gönderimi reddetti (30)'));

      try {
        const res = await http(app)
          .post('/api/v1/auth/phone/start')
          .set(auth(fixture.owner.tokens))
          .send({ phone: '0532 999 88 77' });

        // Kod üretildi ve saklandı; yalnız teslim edilemedi.
        expect(res.status).toBe(200);
        expect((res.body as { delivered: boolean }).delivered).toBe(false);
        const { rows } = await database.ownerPool.query('select 1 from phone_verification_codes');
        expect(rows).toHaveLength(1);
      } finally {
        sms.send = original;
      }
    });

    it('çok sık kod istenemez (SMS paralıdır)', async () => {
      await http(app)
        .post('/api/v1/auth/phone/start')
        .set(auth(fixture.owner.tokens))
        .send({ phone: '0532 123 45 67' });

      const second = await http(app)
        .post('/api/v1/auth/phone/start')
        .set(auth(fixture.owner.tokens))
        .send({ phone: '0532 123 45 67' });

      expect(second.status).toBe(429);
      expect((second.body as Problem).code).toBe('RATE_LIMITED');
      expect(sms.sent).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('doğrulama', () => {
    const startVerification = async (phone = '0532 123 45 67'): Promise<string> => {
      const res = await http(app)
        .post('/api/v1/auth/phone/start')
        .set(auth(fixture.owner.tokens))
        .send({ phone });
      expect(res.status).toBe(200);
      return lastCode();
    };

    it('doğru kod numarayı GİRİŞ TANIMLAYICISI hâline getirir', async () => {
      const code = await startVerification();

      const verified = await http(app)
        .post('/api/v1/auth/phone/verify')
        .set(auth(fixture.owner.tokens))
        .send({ code });
      expect(verified.status).toBe(200);
      expect((verified.body as { phone: string }).phone).toBe('+905321234567');

      const me = await http(app).get('/api/v1/me').set(auth(fixture.owner.tokens));
      const user = (me.body as { user: { phone: string; phoneVerified: boolean } }).user;
      expect(user.phone).toBe('+905321234567');
      expect(user.phoneVerified).toBe(true);

      // Artık telefonla giriş yapılabilir — aynı oturum modeli, aynı yanıt.
      const byPhone = await login(app, { phone: '+905321234567' });
      expect(byPhone.status).toBe(200);
      expect(byPhone.body.status).toBe('authenticated');

      // Yerel biçimde yazılsa da aynı kullanıcıya çözülür.
      const local = await login(app, { phone: '0532 123 45 67' });
      expect(local.status).toBe(200);
    });

    it('yanlış kod deneme hakkını tüketir, hak bitince kod YANAR', async () => {
      await startVerification();

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const res = await http(app)
          .post('/api/v1/auth/phone/verify')
          .set(auth(fixture.owner.tokens))
          .send({ code: '000000' });
        expect(res.status).toBe(400);
        expect((res.body as { detail: string }).detail).toContain(String(5 - attempt));
      }

      const burned = await http(app)
        .post('/api/v1/auth/phone/verify')
        .set(auth(fixture.owner.tokens))
        .send({ code: '000000' });
      expect(burned.status).toBe(400);

      // Kod komple yandı: DOĞRU kod bile artık geçmez.
      const { rows } = await database.ownerPool.query<{ invalidated_at: string | null }>(
        'select invalidated_at from phone_verification_codes',
      );
      expect(rows[0]?.invalidated_at).not.toBeNull();
    });

    it('süresi dolmuş kod kabul edilmez', async () => {
      const code = await startVerification();
      await database.ownerPool.query(
        `update phone_verification_codes set expires_at = now() - interval '1 minute'`,
      );

      const res = await http(app)
        .post('/api/v1/auth/phone/verify')
        .set(auth(fixture.owner.tokens))
        .send({ code });
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VERIFICATION_FAILED');
    });

    it('yeni kod istendiğinde eski kod geçersizleşir', async () => {
      const first = await startVerification();
      await database.ownerPool.query(
        `update phone_verification_codes set created_at = now() - interval '5 minutes'`,
      );
      const second = await startVerification();
      expect(second).not.toBe(first);

      const withOld = await http(app)
        .post('/api/v1/auth/phone/verify')
        .set(auth(fixture.owner.tokens))
        .send({ code: first });
      expect(withOld.status).toBe(400);

      const withNew = await http(app)
        .post('/api/v1/auth/phone/verify')
        .set(auth(fixture.owner.tokens))
        .send({ code: second });
      expect(withNew.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('numaranın tekilliği', () => {
    it('bir numara aynı anda YALNIZ TEK hesapta doğrulanmış olabilir', async () => {
      const code = await http(app)
        .post('/api/v1/auth/phone/start')
        .set(auth(fixture.owner.tokens))
        .send({ phone: '+905321234567' })
        .then(() => lastCode());
      await http(app)
        .post('/api/v1/auth/phone/verify')
        .set(auth(fixture.owner.tokens))
        .send({ code });

      const member = await inviteMember(app, fixture.owner.tokens, {
        email: 'ikinci@telefon.test',
        roleKey: 'manager',
        branchId: fixture.branch.id,
      });

      const res = await http(app)
        .post('/api/v1/auth/phone/start')
        .set(auth(member.tokens))
        .send({ phone: '+905321234567' });

      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('PHONE_IN_USE');
    });

    it('numara kaldırıldıktan sonra başka hesapta doğrulanabilir', async () => {
      const code = await http(app)
        .post('/api/v1/auth/phone/start')
        .set(auth(fixture.owner.tokens))
        .send({ phone: '+905321234567' })
        .then(() => lastCode());
      await http(app)
        .post('/api/v1/auth/phone/verify')
        .set(auth(fixture.owner.tokens))
        .send({ code });

      const removed = await http(app).delete('/api/v1/auth/phone').set(auth(fixture.owner.tokens));
      expect(removed.status).toBe(204);

      // Artık telefonla giriş yapılamaz.
      expect((await login(app, { phone: '+905321234567' })).status).toBe(401);

      const member = await inviteMember(app, fixture.owner.tokens, {
        email: 'devir@telefon.test',
        roleKey: 'manager',
        branchId: fixture.branch.id,
      });
      const start = await http(app)
        .post('/api/v1/auth/phone/start')
        .set(auth(member.tokens))
        .send({ phone: '+905321234567' });
      expect(start.status).toBe(200);

      const verified = await http(app)
        .post('/api/v1/auth/phone/verify')
        .set(auth(member.tokens))
        .send({ code: lastCode() });
      expect(verified.status).toBe(200);
    });

    it('doğrulanmış numara veritabanı seviyesinde de tekildir', async () => {
      const code = await http(app)
        .post('/api/v1/auth/phone/start')
        .set(auth(fixture.owner.tokens))
        .send({ phone: '+905321234567' })
        .then(() => lastCode());
      await http(app)
        .post('/api/v1/auth/phone/verify')
        .set(auth(fixture.owner.tokens))
        .send({ code });

      // Uygulama katmanı atlansa bile kısmi tekil indeks yazdırmaz.
      await expect(
        database.ownerPool.query(
          `insert into users (email, full_name, phone, phone_verified_at)
           values ('capraz@telefon.test', 'Çapraz', '+905321234567', now())`,
        ),
      ).rejects.toThrow(/users_phone_verified_key/);
    });

    it('telefon logda MASKELENİR', async () => {
      // Gönderici numarayı maskeli loglar; ham numara log akışına girmez.
      const { maskPhone } = await import('../../src/observability/redaction');
      const masked = maskPhone('+905321234567');
      expect(masked.startsWith('+90')).toBe(true);
      expect(masked.endsWith('67')).toBe(true);
      expect(masked).not.toContain('53212345');
    });
  });
});
