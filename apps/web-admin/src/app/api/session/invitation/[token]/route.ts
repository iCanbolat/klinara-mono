import { NextResponse, type NextRequest } from 'next/server';
import { planFromInvitationAccept } from '@/lib/session/login-step';
import { problemResponse, readJsonBody, runAuthFlow, unavailable } from '@/lib/session/handlers';
import { callUpstreamJson } from '@/lib/session/upstream';

/**
 * Davet önizleme (GET) ve kabul (POST).
 *
 * ⚠️ Kabulün İKİ yanıt şekli var: yeni hesapta oturum açılır, parolası ZATEN
 * kurulu bir hesapta yalnız üyelik eklenir (`membership_added`) ve oturum
 * AÇILMAZ. İkincisi gözden kaçarsa kullanıcı "kabul ettim ama hiçbir şey
 * olmadı" ekranında kalır — bu yüzden `planFromInvitationAccept` ayrı bir
 * eşleyici.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface InvitationPreview {
  email: string;
  fullName: string | null;
  tenantName: string;
  roleKey: string;
  roleName: string;
  expiresAt: string;
  accountExists: boolean;
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const result = await callUpstreamJson<InvitationPreview>(
    `invitations/token/${encodeURIComponent(token)}`,
    { method: 'GET' },
  );
  if (result === null) return unavailable();
  if (result.problem !== null) return problemResponse(result.problem, result.status);
  return NextResponse.json(result.data);
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const body = (await readJsonBody(request)) ?? {};
  return runAuthFlow(
    `invitations/token/${encodeURIComponent(token)}/accept`,
    {
      ...(typeof body.password === 'string' ? { password: body.password } : {}),
      ...(typeof body.fullName === 'string' ? { fullName: body.fullName } : {}),
    },
    { plan: planFromInvitationAccept },
  );
}
