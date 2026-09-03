import { type NextRequest } from 'next/server';
import { badRequest, readJsonBody, runAuthFlow } from '@/lib/session/handlers';
import { readChallenge } from '@/lib/session/store';

/**
 * Kiracı seçimi.
 *
 * `challengeToken` İSTEMCİDEN GELMİYOR, cookie'den okunuyor: tarayıcıya hiç
 * inmediği için istemcinin onu geri gönderebilmesi mümkün değil. Bu, bir
 * kimlik bilgisini bir adım daha az yerde dolaştırmak demek.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) return badRequest('Gövde okunamadı.');
  if (typeof body.tenantId !== 'string') return badRequest('Kiracı seçilmedi.');

  const challenge = await readChallenge();
  if (challenge === null || challenge.kind !== 'tenant_select') {
    // Beş dakikalık pencere doldu ya da akış baştan başlamalı.
    return badRequest('Giriş oturumu zaman aşımına uğradı. Lütfen yeniden giriş yapın.');
  }

  return runAuthFlow('auth/tenant', {
    challengeToken: challenge.ct,
    tenantId: body.tenantId,
  });
}
