import { type NextRequest } from 'next/server';
import { badRequest, readJsonBody, runAuthFlow } from '@/lib/session/handlers';

/**
 * E-posta + parola girişi.
 *
 * Yanıt üç şekilden biri: `authenticated` (cookie'ler yazıldı),
 * `tenant` (kiracı seçimi gerekiyor) ya da `mfa`. Token'ların hiçbiri gövdede
 * dönmüyor — bkz. `lib/session/login-step.ts`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const body = await readJsonBody(request);
  if (body === null) return badRequest('Gövde okunamadı.');

  const { email, password, deviceLabel } = body;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return badRequest('E-posta ve parola zorunlu.');
  }

  return runAuthFlow('auth/login', {
    email,
    password,
    ...(typeof deviceLabel === 'string' ? { deviceLabel } : {}),
  });
}
