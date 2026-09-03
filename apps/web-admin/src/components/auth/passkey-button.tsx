'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { useState, type ReactNode } from 'react';
import type { SessionStep } from '@klinara/shared';
import { sessionCall } from '@/lib/api/client';
import { t } from '@/i18n/tr';
import { Button } from '@/components/ui/button';

/**
 * Passkey ile giriş.
 *
 * WebAuthn tarayıcının ORIGIN'ine bağlı çalışıyor ve o origin web-admin —
 * API'nin adresi bu akışta hiç geçmiyor. Dolaşan tek şey bir challenge, ki o
 * da kimlik bilgisi değil; bu yüzden BFF'ten geçmesinde sakınca yok.
 *
 * ⚠️ `WEBAUTHN_ORIGINS` ve `WEBAUTHN_RP_ID` bu uygulamanın adresini içermeli;
 * `rpId` sonradan DEĞİŞTİRİLEMEZ (değişirse tüm passkey'ler geçersizleşir).
 */
export function PasskeyButton({
  onStep,
  onError,
}: {
  onStep: (step: SessionStep) => void;
  onError: (message: string) => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);

  async function start(): Promise<void> {
    setBusy(true);
    try {
      // E-posta gönderilmiyor: keşfedilebilir (discoverable) kimlik bilgisi
      // akışı, kullanıcıya önce e-posta yazdırmaktan daha az sürtünmeli.
      const options = await sessionCall<Record<string, unknown>>('passkey/options');
      const assertion = await startAuthentication({
        optionsJSON: options as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      });
      onStep(await sessionCall<SessionStep>('passkey/verify', { response: assertion }));
    } catch {
      // Kullanıcının iptal etmesi de buraya düşüyor ve bu bir hata değil;
      // yine de parolayla devam edebileceğini söylemek doğru yönlendirme.
      onError(t('auth.login.passkeyFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="secondary" loading={busy} onClick={() => void start()}>
      {t('auth.login.passkey')}
    </Button>
  );
}
