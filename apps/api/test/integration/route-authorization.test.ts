import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ALL_PERMISSIONS } from '@klinara/shared';
import { createTestApp } from '../helpers/app';
import { collectRoutes, type RouteInfo } from '../helpers/routes';

/**
 * Batch 10.3 — "her uç bir yetki kontrolüne sahip mi" kapsam testi.
 *
 * `PermissionsGuard` zaten fail-closed: izni unutulmuş bir uç 403 verir. Ama o
 * hata ancak biri o ucu ÇAĞIRDIĞINDA görülür ve 403, "yetkin yok" ile "bu uç
 * yanlış yazılmış"ı aynı cevaba indirir. Buradaki iddia derleme sonrası, tek
 * seferde ve istek göndermeden kurulur.
 *
 * Listeler ANLIK GÖRÜNTÜ değil, KARAR kaydıdır: kimlik istemeyen ya da izne
 * bağlı olmayan her uç aşağıda tek tek yazılıdır. Yeni bir tanesi eklendiğinde
 * test kırılır — kırılması işin kendisidir, çünkü "bu ucu gerçekten herkese mi
 * açıyoruz" sorusu code review'da bir kez daha sorulur.
 */

/** Kimlik doğrulaması İSTEMEYEN uçlar. Her biri kasıtlıdır. */
const PUBLIC_ROUTES = [
  // Altyapı: yük dengeleyici ve Prometheus. `/metrics` kendi token'ıyla korunur
  // (`MetricsTokenGuard`), `@Public()` yalnız KİRACI kimliğini atlar.
  'GET /healthz',
  'GET /readyz',
  'GET /metrics/',

  // Giriş akışı: oturum henüz yokken çağrılabilmeli.
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/tenant',
  'POST /auth/passkey/options',
  'POST /auth/passkey/verify',
  'POST /auth/password/forgot',
  'POST /auth/password/reset',

  // 2FA kurulumu: access token'ı VEYA giriş akışının `mfa` ara token'ı kabul
  // edilir; ikisini de guard bilmez, doğrulama handler'ın içindedir
  // (`TotpController.actorOf` — token yoksa 401).
  'POST /auth/2fa/setup',
  'POST /auth/2fa/enable',
  'POST /auth/2fa/verify',

  // Davet: alıcının henüz hesabı yoktur; yetki token'ın kendisindedir.
  'GET /invitations/token/:token',
  'POST /invitations/token/:token/accept',

  // Online randevu sayfası (Faz 9): slug + `PublicSiteGuard` kiracıyı çözer.
  'GET /public/resolve',
  'GET /public/sites/:slug/',
  'GET /public/sites/:slug/branches',
  'GET /public/sites/:slug/services',
  'GET /public/sites/:slug/staff',
  'GET /public/sites/:slug/availability',
  'POST /public/sites/:slug/holds',
  'POST /public/sites/:slug/holds/:holdToken/otp',
  'POST /public/sites/:slug/holds/:holdToken/otp/verify',
  'DELETE /public/sites/:slug/holds/:holdToken',
  'POST /public/sites/:slug/appointments',

  // Müşterinin kendi randevusu: yetki imzalı `token`dadır, oturum yoktur.
  'GET /public/sites/:slug/appointments/:token',
  'GET /public/sites/:slug/appointments/:token/ics',
  'POST /public/sites/:slug/appointments/:token/cancel',
  'POST /public/sites/:slug/appointments/:token/reschedule',

  // WhatsApp webhook'u: kimlik HMAC imzasıyla doğrulanır (Batch 8.3).
  'GET /webhooks/whatsapp/',
  'POST /webhooks/whatsapp/',

  // Yerel depolama sürücüsü: imzalı, süreli URL. YALNIZ geliştirmede kayıtlı
  // (`STORAGE_DRIVER=local`); üretimde S3 presigned URL kullanılır.
  'GET /uploads/local/get',
  'PUT /uploads/local/put',
];

/** Kimlik ister, İZİN istemez: kullanıcının kendi hesabı üzerindeki işlemler. */
const SELF_SERVICE_ROUTES = [
  'GET /me',
  'PATCH /me',
  'GET /auth/sessions',
  'DELETE /auth/sessions/:id',
  'POST /auth/logout',
  'POST /auth/logout-all',
  'POST /auth/password/change',
  'GET /auth/2fa/',
  'DELETE /auth/2fa/',
  'POST /auth/2fa/backup-codes',
  'GET /auth/passkeys',
  'POST /auth/passkeys/register/options',
  'POST /auth/passkeys/register',
  'PATCH /auth/passkeys/:id',
  'DELETE /auth/passkeys/:id',
  'POST /auth/phone/start',
  'POST /auth/phone/verify',
  'DELETE /auth/phone/',
];

/** Platform token'ı ile korunan kiracı-üstü uçlar. */
const PLATFORM_ROUTES = ['POST /platform/tenants/'];

/** Kenar proxy'sinin (Caddy) iç uçları — kendi token'ı. */
const EDGE_ROUTES = ['GET /internal/booking-domains/authorize'];

const format = (routes: RouteInfo[]): string[] =>
  routes.map((route) => `${route.signature} (${route.controller}.${route.handler})`);

describe('rota × yetki kapsamı', () => {
  let app: NestExpressApplication;
  let routes: RouteInfo[];

  beforeAll(async () => {
    app = await createTestApp();
    routes = collectRoutes(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('envanter gerçekten dolu — sessizce boş kalan bir test hiçbir şey kanıtlamaz', () => {
    expect(routes.length).toBeGreaterThan(150);
  });

  it('yetki kontrolü OLMAYAN tek bir uç yok', () => {
    const unguarded = routes.filter((route) => route.kind === 'unguarded');
    expect(format(unguarded)).toEqual([]);
  });

  it('kimlik doğrulaması istemeyen uçlar tam olarak listedeki uçlardır', () => {
    const actual = routes.filter((route) => route.kind === 'public').map((r) => r.signature);
    expect(actual.sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  it('izin istemeyen (kendi hesabı) uçlar tam olarak listedeki uçlardır', () => {
    const actual = routes.filter((route) => route.kind === 'selfService').map((r) => r.signature);
    expect(actual.sort()).toEqual([...SELF_SERVICE_ROUTES].sort());
  });

  it('platform ve kenar uçları tam olarak listedeki uçlardır', () => {
    const platform = routes.filter((r) => r.kind === 'platformAdmin').map((r) => r.signature);
    const edge = routes.filter((r) => r.kind === 'edgeOnly').map((r) => r.signature);
    expect(platform.sort()).toEqual([...PLATFORM_ROUTES].sort());
    expect(edge.sort()).toEqual([...EDGE_ROUTES].sort());
  });

  it('geri kalan her uç izne bağlı ve izinlerin hepsi katalogda tanımlı', () => {
    const guarded = routes.filter(
      (route) => route.kind === 'permission' || route.kind === 'anyPermission',
    );
    // Uçların ezici çoğunluğu izne bağlı olmalı; liste tarafında bir kayma
    // (örneğin bir modülün komple `@Public()` olması) burada da görünür.
    expect(guarded.length).toBeGreaterThan(routes.length / 2);

    const catalog = new Set<string>(ALL_PERMISSIONS);
    const unknown = guarded
      .filter((route) => route.permissions.some((p) => !catalog.has(p)))
      .map((route) => `${route.signature} → ${route.permissions.join(', ')}`);
    expect(unknown).toEqual([]);
  });

  it('katalogdaki her izin ya bir uçta ya da servis katmanında kullanılıyor', () => {
    const used = new Set<string>(routes.flatMap((route) => route.permissions));

    /**
     * Uca BAĞLANMAYAN ama servis katmanında gerçekten kontrol edilen izinler.
     * Guard'ın kapıyı açtığı yerde görünürlüğü/işlemi DARALTIRLAR; uca
     * bağlanmaları yanlış olurdu, çünkü izin yokken uç 403 değil "daha az veri"
     * döndürmelidir.
     */
    const enforcedInServices = [
      'customer.medical:read', // notes.service.ts, files.service.ts
      'customer.medical:write',
      'finance.price:override', // charges.service.ts
    ];

    /**
     * HİÇBİR YERDE kontrol edilmeyen izinler — rol demetlerinde dağıtılıyorlar
     * ama karşılıkları henüz yok. 10.3'ün bulgusu: verilmiş ama hiçbir kapıyı
     * açmayan bir izin, güvenlik incelemesinde "bu rol bunu yapabiliyor"
     * sanılmasına yol açar. Silinmediler çünkü ait oldukları iş planda duruyor;
     * listede durmaları o işin borcunu görünür tutuyor.
     */
    const notYetEnforced = [
      'consent:read', // Faz 7 (onam ve KVKK) — henüz yazılmadı
      'consent:manage',
      'audit:read', // denetim kaydını OKUYAN bir uç yok (audit_log yalnız yazılıyor)
      'appointment:reopen', // tamamlanmış randevuyu geri açma ucu yok
      'resource:read', // eski kapsamdan kalan anahtarlar; yerlerini STAFF/SCHEDULE aldı
      'resource:write',
    ];

    const unused = ALL_PERMISSIONS.filter((permission) => !used.has(permission));
    expect(unused.sort()).toEqual([...enforcedInServices, ...notYetEnforced].sort());
  });
});
