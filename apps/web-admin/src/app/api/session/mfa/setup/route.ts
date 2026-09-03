import { NextResponse } from 'next/server';
import { problemResponse, unavailable } from '@/lib/session/handlers';
import { readAccess, readChallenge } from '@/lib/session/store';
import { callUpstreamJson } from '@/lib/session/upstream';

/**
 * 2FA kurulumu — API'nin ÇİFT TOKEN kabul eden ucu.
 *
 * `totp.controller.ts` bu ucu ya normal erişim token'ıyla ya da `mfa`
 * challenge token'ıyla (Bearer olarak) kabul ediyor. İkincisi, kiracının 2FA'yı
 * zorunlu kıldığı ama kullanıcının henüz kurmadığı durum için: kullanıcı giriş
 * yapamıyor ama kurulumu yapması gerekiyor.
 *
 * ⚠️ Bu quirk, challenge token'ının neden cookie'de durduğunun asıl sebebi.
 * İstemci belleğinde tutulsaydı, ikinci faktörün TESİS EDİLDİĞİ beş dakikalık
 * pencerede bir XSS saldırgana kendi authenticator'ını kaydettirebilirdi.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const bearer = await mfaBearer();
  if (bearer === null) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await callUpstreamJson<{ secret: string; otpauthUri: string }>('auth/2fa/setup', {
    method: 'POST',
    bearer,
  });
  if (result === null) return unavailable();
  if (result.problem !== null) return problemResponse(result.problem, result.status);
  return NextResponse.json(result.data);
}

/** Erişim token'ı varsa o, yoksa `mfa` challenge token'ı. */
export async function mfaBearer(): Promise<string | null> {
  const access = await readAccess();
  if (access !== null) return access.at;
  const challenge = await readChallenge();
  return challenge !== null && challenge.kind === 'mfa' ? challenge.ct : null;
}
