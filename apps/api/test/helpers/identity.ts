import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Kimlik fixture'ları.
 *
 * Faz 1'den sonra HİÇBİR uç başlıkla kiracı seçmez: her istek gerçek bir access
 * token taşır. Testlerin de aynı yoldan geçmesi kasıtlıdır — "testte başka,
 * üretimde başka" sınıfı sapmaların önüne geçer.
 */

export const PLATFORM_TOKEN = 'platform-admin-test-tokeni-32-karakterden-uzun';
export const DEFAULT_PASSWORD = 'cok-gizli-parola-123';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface TenantFixture {
  tenant: { id: string; slug: string; name: string; timezone: string; status: string };
  branch: { id: string; tenantId: string; slug: string; name: string };
  owner: { userId: string; email: string; tokens: Tokens };
}

export interface LoginBody {
  status: string;
  tokens?: Tokens;
  challengeToken?: string;
  tenants?: { id: string; slug: string; name: string }[];
  mfa?: { configured: boolean; methods: string[] };
}

export const http = (app: NestExpressApplication) => request(app.getHttpServer());

export const auth = (tokens: Tokens | string) => ({
  authorization: `Bearer ${typeof tokens === 'string' ? tokens : tokens.accessToken}`,
});

/** Platform yöneticisi olarak kiracı açar ve sahip davetini kabul eder. */
export async function bootstrapTenant(
  app: NestExpressApplication,
  options: {
    slug: string;
    name?: string;
    ownerEmail?: string;
    password?: string;
    branchSlug?: string;
  },
): Promise<TenantFixture> {
  const ownerEmail = options.ownerEmail ?? `sahip@${options.slug}.test`;
  const password = options.password ?? DEFAULT_PASSWORD;

  const created = await http(app)
    .post('/api/v1/platform/tenants')
    .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
    .send({
      slug: options.slug,
      name: options.name ?? options.slug,
      branch: { slug: options.branchSlug ?? 'merkez', name: 'Merkez Şube' },
      owner: { email: ownerEmail, fullName: 'Klinik Sahibi' },
    });

  if (created.status !== 201) {
    throw new Error(`Kiracı oluşturulamadı: ${created.status} ${JSON.stringify(created.body)}`);
  }

  const body = created.body as TenantFixture & {
    ownerInvitation: { token: string; email: string };
  };

  const accepted = await http(app)
    .post(`/api/v1/invitations/token/${body.ownerInvitation.token}/accept`)
    .send({ password, fullName: 'Klinik Sahibi' });

  if (accepted.status !== 200) {
    throw new Error(`Davet kabul edilemedi: ${accepted.status} ${JSON.stringify(accepted.body)}`);
  }

  const tokens = (accepted.body as LoginBody).tokens;
  if (tokens === undefined) throw new Error('Davet kabulünde token dönmedi');

  const me = await http(app).get('/api/v1/me').set(auth(tokens));

  return {
    tenant: body.tenant,
    branch: body.branch,
    owner: {
      userId: (me.body as { user: { id: string } }).user.id,
      email: ownerEmail,
      tokens,
    },
  };
}

export interface InviteOptions {
  email: string;
  roleKey: string;
  branchId?: string;
  password?: string;
  fullName?: string;
}

/**
 * Davet oluşturur ve kabul eder; ham kabul yanıtını döner.
 *
 * Mevcut bir hesabı davet ettiğinizde yanıt `membership_added` olur ve token
 * DÖNMEZ — bu kasıtlıdır (hesap devralma koruması), bu yüzden ham yanıt lazım.
 */
export async function invite(
  app: NestExpressApplication,
  inviter: Tokens,
  options: InviteOptions,
): Promise<LoginBody> {
  const invitation = await http(app)
    .post('/api/v1/invitations')
    .set(auth(inviter))
    .send({
      email: options.email,
      roleKey: options.roleKey,
      ...(options.branchId !== undefined ? { branchId: options.branchId } : {}),
      fullName: options.fullName ?? options.email,
    });

  if (invitation.status !== 201) {
    throw new Error(
      `Davet oluşturulamadı: ${invitation.status} ${JSON.stringify(invitation.body)}`,
    );
  }

  const token = (invitation.body as { token: string }).token;
  const accepted = await http(app)
    .post(`/api/v1/invitations/token/${token}/accept`)
    .send({ password: options.password ?? DEFAULT_PASSWORD, fullName: options.fullName });

  if (accepted.status !== 200) {
    throw new Error(`Davet kabul edilemedi: ${accepted.status} ${JSON.stringify(accepted.body)}`);
  }
  return accepted.body as LoginBody;
}

/** Yeni bir kullanıcıyı davet edip kabul ettirir; token'larını döner. */
export async function inviteMember(
  app: NestExpressApplication,
  inviter: Tokens,
  options: InviteOptions,
): Promise<{ userId: string; tokens: Tokens }> {
  const tokens = (await invite(app, inviter, options)).tokens;
  if (tokens === undefined) throw new Error('Davet kabulünde token dönmedi');

  const me = await http(app).get('/api/v1/me').set(auth(tokens));
  return { userId: (me.body as { user: { id: string } }).user.id, tokens };
}

export async function login(
  app: NestExpressApplication,
  credentials: { email?: string; phone?: string; password?: string },
): Promise<{ status: number; body: LoginBody }> {
  const response = await http(app)
    .post('/api/v1/auth/login')
    .send({ ...credentials, password: credentials.password ?? DEFAULT_PASSWORD });
  return { status: response.status, body: response.body as LoginBody };
}
