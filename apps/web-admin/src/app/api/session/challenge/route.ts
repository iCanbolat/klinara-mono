import { NextResponse } from 'next/server';
import type { SessionStep } from '@klinara/shared';
import { readChallenge } from '@/lib/session/store';

/**
 * Devam eden çok adımlı girişin SIR OLMAYAN bağlamı.
 *
 * Kiracı seçimi ve MFA kendi rotalarında yaşıyor (geri düğmesi, odak yönetimi
 * ve derin bağlantı için); o sayfalar yüklendiğinde listeyi buradan okuyorlar.
 * Challenge token'ının kendisi ASLA dönmüyor — yalnız ekranı çizmek için
 * gereken veri.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const challenge = await readChallenge();
  if (challenge === null) {
    // Pencere doldu ya da hiç başlamadı; istemci girişe dönmeli.
    return NextResponse.json({ error: 'no_challenge' }, { status: 404 });
  }

  const step: SessionStep =
    challenge.kind === 'tenant_select'
      ? { step: 'tenant', tenants: challenge.tenants ?? [] }
      : {
          step: 'mfa',
          configured: challenge.mfaConfigured ?? false,
          methods: challenge.mfaMethods ?? [],
        };
  return NextResponse.json(step);
}
